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
    const form = formidable({
      maxFileSize: 20 * 1024 * 1024,
      keepExtensions: true,
    })
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

    const systemPrompt = `You are an expert academic examiner and re-evaluation specialist with decades of experience checking exam papers across all subjects. Your job is to carefully read handwritten student answer sheets (provided as PDFs), compare them meticulously against the official marking scheme, and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

You have exceptional ability to:
- Read messy, unclear, and semi-illegible handwriting
- Interpret diagrams, equations, graphs, and tables from scans
- Understand partial credit scenarios
- Recognise logically valid approaches that differ from but are equivalent to the model answer
- Spot where examiners may have missed a valid step

You always respond in valid JSON only, with no preamble, no markdown code blocks, and no trailing text. Your entire response must be parseable JSON.`

    const userPrompt = `Carefully read the attached scanned answer sheet PDF. Then perform a thorough re-evaluation analysis.

QUESTION PAPER:
${questionPaper}

MARKING SCHEME:
${markingScheme}

ADDITIONAL CONTEXT:
- Total marks available: ${totalMarks || 'Not specified'}
- Marks awarded by examiner: ${marksAwarded || 'Not specified'}

INSTRUCTIONS:
1. Read every page of the answer sheet carefully, paying attention to all writing even if partially illegible
2. For each question, compare the student's answer against the marking scheme step by step
3. Identify: missing marks (where student did the work but marks were not given), excess deductions, valid alternative approaches, and correctly marked questions
4. Check if any examiner annotations (ticks, crosses, numbers written on paper) match what the marking scheme requires
5. For each finding, state clearly which question number is affected
6. For beyond-the-answer-key checks: if the student used a different but logically valid method, flag this as an alternative valid approach
7. Be fair and objective — do not flag questions unless there is a genuine discrepancy

Respond ONLY with a JSON object in exactly this format (no markdown, no code fences, pure JSON):
{
  "totalQuestions": <number of questions analysed>,
  "flaggedCount": <number of questions with potential errors>,
  "potentialMarksDifference": <total marks potentially owed to student as integer, use 0 if none>,
  "overallVerdict": "<one paragraph overall assessment of the marking quality>",
  "confidence": "<your confidence level, one of: High, Medium, Low>",
  "summary": "<2-3 sentences on what the student should do next>",
  "findings": [
    {
      "questionNumber": "<e.g. 1a, 2, 3b>",
      "severity": "<one of: critical, likely, possible, correct>",
      "issueTitle": "<short title max 8 words>",
      "issue": "<clear explanation of what appears to be wrong or correct, 2-4 sentences>",
      "reasoning": "<detailed reasoning — what the scheme says, what the student wrote, why there is or is not a discrepancy>",
      "recommendation": "<what the student should say when requesting re-evaluation for this question>",
      "marksAwarded": <number or null>,
      "marksDeserved": <number or null>,
      "beyondKeyValid": <true or false>
    }
  ]
}

Severity definitions:
- critical: Clear marking error that almost certainly cost the student marks
- likely: Probable error with strong evidence but some ambiguity
- possible: Minor oversight worth querying
- correct: Question appears to have been marked correctly

Sort findings by severity: critical first, then likely, then possible, then correct.`

    // Use the Anthropic SDK with DocumentBlockParam type
    const documentBlock: Anthropic.DocumentBlockParam = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64,
      },
    }

    const textBlock: Anthropic.TextBlockParam = {
      type: 'text',
      text: userPrompt,
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [documentBlock, textBlock],
        },
      ],
    })

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI')
    }

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
      throw new Error('Invalid analysis result structure. Please try again.')
    }

    try {
      fs.unlinkSync(answerFile.filepath)
    } catch {
      // Non-critical cleanup
    }

    return res.status(200).json(analysisResult)
  } catch (error: unknown) {
    console.error('Analysis error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Analysis failed'

    if (errorMessage.includes('Could not process document') || errorMessage.toLowerCase().includes('pdf')) {
      return res.status(400).json({
        error: 'Could not read the PDF. Please ensure it is a valid, non-password-protected PDF and try again.',
      })
    }

    return res.status(500).json({
      error: errorMessage || 'An unexpected error occurred. Please try again.',
    })
  }
}
