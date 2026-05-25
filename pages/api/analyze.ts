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

async function extractText(pdfB64: string, role: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: 'claude-opus-4-5',
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `You are reading a ${role} that has been provided as a base64-encoded PDF. Transcribe ALL content exactly as it appears — including handwriting, question numbers, marks, ticks, crosses, examiner annotations, diagrams described in words, and any numbers written on the page. Preserve structure and numbering precisely. Do not summarise or skip anything.\n\ndata:application/pdf;base64,${pdfB64}`
    }]
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = response.content.find((c: any) => c.type === 'text')
  return text ? text.text : ''
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

    // Read all three files into memory first, then delete from disk immediately
    const schemeB64 = fileToBase64(schemeFile)
    cleanupFile(schemeFile)
    schemeFile = null

    const paperB64 = fileToBase64(paperFile)
    cleanupFile(paperFile)
    paperFile = null

    const answerB64 = fileToBase64(answerFile)
    cleanupFile(answerFile)
    answerFile = null

    // Step 1 — Read marking scheme
    const schemeText = await extractText(schemeB64, 'marking scheme for an exam')
    await delay(500)

    // Step 2 — Read question paper
    const paperText = await extractText(paperB64, 'question paper for an exam')
    await delay(500)

    // Step 3 — Read answer sheet (most important — detailed instruction)
    const answerText = await extractText(
      answerB64,
      'student handwritten answer sheet. Pay very close attention to: all handwriting even if messy, every step of working shown, diagrams and their labels, and any examiner marks written on the sheet such as ticks, crosses, circled numbers, totals, or deductions'
    )
    await delay(500)

    // Step 4 — Full re-evaluation analysis using extracted text
    const systemPrompt = `You are an expert academic examiner and re-evaluation specialist with decades of experience. You have been given the transcribed content of three exam documents. Your job is to compare the student's answers against the marking scheme question by question and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

You always respond in valid JSON only, with no preamble, no markdown, no code fences, and no trailing text.`

    const userPrompt = `Perform a thorough and fair re-evaluation analysis using the transcribed content below.

MARKING SCHEME:
${schemeText}

---

QUESTION PAPER:
${paperText}

---

STUDENT ANSWER SHEET (including examiner marks):
${answerText}

---

CONTEXT:
- Total marks available: ${totalMarks || 'Not specified'}
- Marks awarded by examiner: ${marksAwarded || 'Not specified'}

INSTRUCTIONS:
1. Go through every question one by one
2. Compare what the student wrote against what the marking scheme awards marks for
3. Check whether the examiner's marks on the sheet match what the scheme says
4. Flag questions where marks were missed, wrongly deducted, or where the student used a valid alternative method not in the answer key
5. Also note questions that were marked correctly so the student has the full picture
6. Be fair — only flag genuine discrepancies, not borderline cases

Respond ONLY with this exact JSON (pure JSON, no markdown, no code fences):
{
  "totalQuestions": <number of questions analysed>,
  "flaggedCount": <number with potential errors>,
  "potentialMarksDifference": <total marks potentially owed, as integer, 0 if none>,
  "overallVerdict": "<one paragraph honest assessment of marking quality>",
  "confidence": "<High, Medium, or Low>",
  "summary": "<2-3 sentences telling the student what to do next>",
  "findings": [
    {
      "questionNumber": "<e.g. 1, 1a, 2b, 3>",
      "severity": "<critical, likely, possible, or correct>",
      "issueTitle": "<max 8 words>",
      "issue": "<2-4 sentences explaining what appears wrong or correct>",
      "reasoning": "<detailed explanation — what the scheme says, what the student wrote, and why there is or is not a discrepancy>",
      "recommendation": "<exact wording the student can use when requesting re-evaluation for this question>",
      "marksAwarded": <number awarded by examiner, or null>,
      "marksDeserved": <number student should have received per scheme, or null>,
      "beyondKeyValid": <true if student used valid alternative method, false otherwise>
    }
  ]
}

Sort findings: critical first, then likely, then possible, then correct.`

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
