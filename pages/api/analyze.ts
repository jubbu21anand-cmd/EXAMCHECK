import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    sizeLimit: '50mb',
  },
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true })
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

    const systemPrompt = `You are an expert academic examiner and re-evaluation specialist. You will be given three PDFs: the marking scheme, the question paper, and the student's handwritten answer sheet. Your job is to compare the student's answers against the marking scheme and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

You have exceptional ability to read messy handwriting, interpret diagrams and equations from scans, understand partial credit, recognise logically valid alternative approaches, and spot where examiners missed valid steps.

You always respond in valid JSON only, with no preamble, no markdown, no code fences, and no trailing text.`

    const userPrompt = `I am providing three base64-encoded PDFs for re-evaluation analysis.

MARKING SCHEME PDF (base64): data:application/pdf;base64,${schemeB64}

QUESTION PAPER PDF (base64): data:application/pdf;base64,${paperB64}

STUDENT ANSWER SHEET PDF (base64): data:application/pdf;base64,${answerB64}

ADDITIONAL CONTEXT:
- Total marks available: ${totalMarks || 'Not specified'}
- Marks awarded by examiner: ${marksAwarded || 'Not specified'}

INSTRUCTIONS:
1. Read all three documents carefully
2. For each question, compare the student's answer against the marking scheme step by step
3. Identify: missing marks (student did the work but was not given marks), excess deductions, valid alternative approaches, and correctly marked questions
4. Check if examiner annotations on the answer sheet match what the marking scheme requires
5. For beyond-the-answer-key checks: if the student used a different but logically valid method, flag as alternative valid approach
6. Be fair and objective — only flag genuine discrepancies

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

    cleanupFile(schemeFile)
    cleanupFile(paperFile)
    cleanupFile(answerFile)

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
