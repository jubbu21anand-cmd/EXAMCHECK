import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: false,
  },
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'API key not configured. Please set ANTHROPIC_API_KEY in your Vercel environment variables.',
    })
  }

  try {
    const { fields, files } = await parseForm(req)

    const markingScheme = getField(fields, 'markingScheme')
    const questionPaper = getField(fields, 'questionPaper')
    const totalMarks = getField(fields, 'totalMarks')
    const marksAwarded = getField(fields, 'marksAwarded')

    if (!markingScheme || !questionPaper) {
      return res.status(400).json({ error: 'Marking scheme and question paper are required.' })
    }

    const answerSheetFile = files.answerSheet
    const answerFile = Array.isArray(answerSheetFile) ? answerSheetFile[0] : answerSheetFile

    if (!answerFile) {
      return res.status(400).json({ error: 'Answer sheet PDF is required.' })
    }

    const pdfBuffer = fs.readFileSync(answerFile.filepath)
    const pdfBase64 = pdfBuffer.toString('base64')

    const systemPrompt = `You are an expert academic examiner and re-evaluation specialist. Your job is to carefully read handwritten student answer sheets (provided as base64-encoded PDFs), compare them against the official marking scheme, and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

You have exceptional ability to read messy handwriting, interpret diagrams and equations from scans, understand partial credit, recognise logically valid alternative approaches, and spot where examiners missed valid steps.

You always respond in valid JSON only, with no preamble, no markdown code blocks, and no trailing text.`

    const userPrompt = `I am providing you with a base64-encoded PDF of a student's handwritten answer sheet. Please read it carefully and perform a thorough re-evaluation analysis.

The PDF data is: data:application/pdf;base64,${pdfBase64}

QUESTION PAPER:
${questionPaper}

MARKING SCHEME:
${markingScheme}

ADDITIONAL CONTEXT:
- Total marks available: ${totalMarks || 'Not specified'}
- Marks awarded by examiner: ${marksAwarded || 'Not specified'}

INSTRUCTIONS:
1. Read every page of the answer sheet carefully, including messy or partially illegible writing
2. For each question, compare the student's answer against the marking scheme step by step
3. Identify: missing marks (student did the work but marks not given), excess deductions, valid alternative approaches, and correctly marked questions
4. Check if examiner annotations (ticks, crosses, numbers on paper) match what the marking scheme requires
5. For beyond-the-answer-key checks: if student used a different but logically valid method, flag as alternative valid approach
6. Be fair and objective

Respond ONLY with a JSON object in this exact format (pure JSON, no markdown):
{
  "totalQuestions": <number of questions analysed>,
  "flaggedCount": <number of questions with potential errors>,
  "potentialMarksDifference": <total marks potentially owed to student as integer>,
  "overallVerdict": "<one paragraph overall assessment of the marking quality>",
  "confidence": "<High, Medium, or Low>",
  "summary": "<2-3 sentences on what the student should do next>",
  "findings": [
    {
      "questionNumber": "<e.g. 1a, 2, 3b>",
      "severity": "<critical, likely, possible, or correct>",
      "issueTitle": "<short title max 8 words>",
      "issue": "<clear explanation 2-4 sentences>",
      "reasoning": "<detailed reasoning — what scheme says, what student wrote, why discrepancy exists>",
      "recommendation": "<what student should say when requesting re-evaluation>",
      "marksAwarded": <number or null>,
      "marksDeserved": <number or null>,
      "beyondKeyValid": <true or false>
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
      console.error('Failed to parse AI response:', rawText.substring(0, 500))
      throw new Error('AI returned an unexpected format. Please try again.')
    }

    if (!analysisResult.findings || !Array.isArray(analysisResult.findings)) {
      throw new Error('Invalid analysis result. Please try again.')
    }

    try { fs.unlinkSync(answerFile.filepath) } catch { /* non-critical */ }

    return res.status(200).json(analysisResult)

  } catch (error: unknown) {
    console.error('Analysis error:', error)
    const msg = error instanceof Error ? error.message : 'Analysis failed'
    return res.status(500).json({ error: msg || 'An unexpected error occurred. Please try again.' })
  }
}
