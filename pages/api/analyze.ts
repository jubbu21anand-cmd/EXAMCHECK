import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '8mb',
    sizeLimit: '8mb',
  },
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024, keepExtensions: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.parse(req, (err: any, fields: formidable.Fields, files: formidable.Files) => {
      if (err) reject(err)
      else resolve({ fields, files })
    })
  })
}

function getField(fields: formidable.Fields, key: string): string {
  const val = fields[key]
  if (Array.isArray(val)) return val[0] || ''
  return String(val ?? '')
}

function getFile(files: formidable.Files, key: string): formidable.File | null {
  const f = files[key]
  if (!f) return null
  return Array.isArray(f) ? f[0] : f
}

function fileToBase64(f: formidable.File): string {
  return fs.readFileSync(f.filepath).toString('base64')
}

function cleanupFile(f: formidable.File | null) {
  if (!f) return
  try { fs.unlinkSync(f.filepath) } catch { /* non-critical */ }
}

async function extractPdfText(pdfB64: string, role: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `This is a base64-encoded PDF of a ${role}. Please read it carefully and transcribe ALL the text content exactly as written, including any handwriting, annotations, question numbers, marks, ticks, crosses, and examiner notes. Preserve the structure and numbering. data:application/pdf;base64,${pdfB64}`
    }]
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = response.content.find((c: any) => c.type === 'text')
  return text ? text.text : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured. Please set ANTHROPIC_API_KEY in Vercel environment variables.' })
  }

  let schemeFile: formidable.File | null = null
  let paperFile: formidable.File | null = null
  let answerFile: formidable.File | null = null

  try {
    const { fields, files } = await parseForm(req)

    const totalMarks = getField(fields, 'totalMarks')
    const marksAwarded = getField(fields, 'marksAwarded')

    schemeFile = getFile(files, 'schemeFile')
    paperFile = getFile(files, 'paperFile')
    answerFile = getFile(files, 'answerSheet')

    if (!schemeFile) return res.status(400).json({ error: 'Marking scheme PDF is required.' })
    if (!paperFile) return res.status(400).json({ error: 'Question paper PDF is required.' })
    if (!answerFile) return res.status(400).json({ error: 'Answer sheet PDF is required.' })

    const schemeB64 = fileToBase64(schemeFile)
    const paperB64 = fileToBase64(paperFile)
    const answerB64 = fileToBase64(answerFile)

    cleanupFile(schemeFile)
    cleanupFile(paperFile)
    cleanupFile(answerFile)

    // Step 1: Extract text from each PDF separately
    const [schemeText, paperText, answerText] = await Promise.all([
      extractPdfText(schemeB64, 'marking scheme'),
      extractPdfText(paperB64, 'question paper'),
      extractPdfText(answerB64, 'student handwritten answer sheet — pay close attention to all handwriting, diagrams, working, and any examiner marks, ticks, crosses, or numbers written on the sheet'),
    ])

    // Step 2: Run the full analysis using extracted text only (no PDFs)
    const systemPrompt = `You are an expert academic examiner and re-evaluation specialist. You will be given the text content of three documents: the marking scheme, the question paper, and the student's answer sheet. Your job is to compare the student's answers against the marking scheme and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

You always respond in valid JSON only, with no preamble, no markdown, no code fences, and no trailing text.`

    const userPrompt = `Perform a thorough re-evaluation analysis using the following extracted document content.

MARKING SCHEME:
${schemeText}

QUESTION PAPER:
${paperText}

STUDENT ANSWER SHEET:
${answerText}

ADDITIONAL CONTEXT:
- Total marks available: ${totalMarks || 'Not specified'}
- Marks awarded by examiner: ${marksAwarded || 'Not specified'}

INSTRUCTIONS:
1. For each question, compare the student's answer against the marking scheme step by step
2. Identify: missing marks (student did the work but was not given marks), excess deductions, valid alternative approaches, and correctly marked questions
3. Check if examiner annotations on the answer sheet match what the marking scheme requires
4. For beyond-the-answer-key checks: if the student used a different but logically valid method, flag as alternative valid approach
5. Be fair and objective — only flag genuine discrepancies

Respond ONLY with this exact JSON format (pure JSON, no markdown):
{
  "totalQuestions": <number>,
  "flaggedCount": <number>,
  "potentialMarksDifference": <integer>,
  "overallVerdict": "<one paragraph assessment>",
  "confidence": "<High, Medium, or Low>",
  "summary": "<2-3 sentences on what the student should do next>",
  "findings": [
    {
      "questionNumber": "<e.g. 1a, 2, 3b>",
      "severity": "<critical, likely, possible, or correct>",
      "issueTitle": "<max 8 words>",
      "issue": "<2-4 sentences>",
      "reasoning": "<detailed reasoning>",
      "recommendation": "<what to say in re-evaluation request>",
      "marksAwarded": <number or null>,
      "marksDeserved": <number or null>,
      "beyondKeyValid": <true or false>
    }
  ]
}

Sort: critical first, then likely, then possible, then correct.`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.messages.create as any)({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textContent = response.content.find((c: any) => c.type === 'text')
    if (!textContent) throw new Error('No text response from AI')

    let rawText = textContent.text.trim()
    rawText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    rawText = rawText.replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

    let analysisResult
    try {
      analysisResult = JSON.parse(rawText)
    } catch {
      console.error('Parse error:', rawText.substring(0, 300))
      throw new Error('AI returned an unexpected format. Please try again.')
    }

    if (!analysisResult.findings || !Array.isArray(analysisResult.findings)) {
      throw new Error('Invalid analysis result. Please try again.')
    }

    return res.status(200).json(analysisResult)

  } catch (error: unknown) {
    cleanupFile(schemeFile)
    cleanupFile(paperFile)
    cleanupFile(answerFile)

    console.error('Analysis error:', error)
    const msg = error instanceof Error ? error.message : 'Analysis failed'
    return res.status(500).json({ error: msg || 'An unexpected error occurred. Please try again.' })
  }
}
