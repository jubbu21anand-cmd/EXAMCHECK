import type { NextApiRequest, NextApiResponse } from 'next'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { pdfB64, role } = req.body

    if (!pdfB64 || !role) {
      return res.status(400).json({ error: 'Missing PDF data or role.' })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured.' })

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: pdfB64,
                }
              },
              {
                text: `You are reading a ${role}. Transcribe ALL content exactly as it appears — including handwriting, question numbers, marks awarded, ticks, crosses, examiner annotations, working steps, and any numbers written on the page. Preserve structure and numbering precisely. Do not summarise or skip anything. If there are diagrams describe them in words.`
              }
            ]
          }],
          generationConfig: {
            maxOutputTokens: 4000,
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('No response from Gemini')

    return res.status(200).json({ text })

  } catch (error: unknown) {
    console.error('Extract error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    return res.status(500).json({ error: msg })
  }
}
