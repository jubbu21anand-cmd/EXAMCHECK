import type { NextApiRequest, NextApiResponse } from 'next'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { schemeText, paperText, answerText, totalMarks, marksAwarded } = req.body

    if (!schemeText || !paperText || !answerText) {
      return res.status(400).json({ error: 'Missing document text. Please try again.' })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured.' })

    const prompt = `You are an expert academic examiner and re-evaluation specialist with decades of experience. Compare the student's answers against the marking scheme question by question and identify every instance where marks may have been incorrectly awarded or wrongly deducted.

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
7. For beyond-the-answer-key checks: if the student used a different but logically valid method, set beyondKeyValid to true

Respond ONLY with this exact JSON (pure JSON, no markdown, no code fences, no extra text):
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 8000,
            temperature: 0.1,
          }
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Gemini error:', JSON.stringify(data))
      throw new Error(data.error?.message || 'Gemini API error')
    }

    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
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
