import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' })
  }

  try {
    const { schemeText, paperText, answerText, totalMarks, marksAwarded } = req.body

    if (!schemeText || !paperText || !answerText) {
      return res.status(400).json({ error: 'Missing document text. Please try again.' })
    }

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
3. Check whether the examiner marks on the sheet match what the scheme requires
4. Flag questions where marks were missed, wrongly deducted, or where the student used a valid alternative method
5. Also note questions marked correctly so the student has the full picture
6. Be fair — only flag genuine discrepancies

Respond ONLY with this exact JSON (pure JSON, no markdown, no code fences):
{
  "totalQuestions": <number>,
  "flaggedCount": <number>,
  "potentialMarksDifference": <integer, 0 if none>,
  "overallVerdict": "<one paragraph honest assessment>",
  "confidence": "<High, Medium, or Low>",
  "summary": "<2-3 sentences on what to do next>",
  "findings": [
    {
      "questionNumber": "<e.g. 1, 1a, 2b>",
      "severity": "<critical, likely, possible, or correct>",
      "issueTitle": "<max 8 words>",
      "issue": "<2-4 sentences>",
      "reasoning": "<detailed explanation>",
      "recommendation": "<exact wording for re-evaluation request>",
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
    console.error('Analysis error:', error)
    const msg = error instanceof Error ? error.message : 'Analysis failed'
    return res.status(500).json({ error: msg || 'An unexpected error occurred.' })
  }
}
