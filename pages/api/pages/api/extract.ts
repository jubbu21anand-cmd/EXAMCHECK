import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { pdfB64, role } = req.body

    if (!pdfB64 || !role) {
      return res.status(400).json({ error: 'Missing PDF data or role.' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.messages.create as any)({
      model: 'claude-opus-4-5',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: `You are reading a ${role} provided as a base64-encoded PDF. Transcribe ALL content exactly as it appears — including handwriting, question numbers, marks awarded, ticks, crosses, examiner annotations, working steps, and any numbers written on the page. Preserve structure and numbering. Do not summarise or skip anything.\n\ndata:application/pdf;base64,${pdfB64}`
      }]
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textContent = response.content.find((c: any) => c.type === 'text')
    if (!textContent) throw new Error('No response from AI')

    return res.status(200).json({ text: textContent.text })

  } catch (error: unknown) {
    console.error('Extract error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    const detail = error instanceof Error ? error.stack : String(error)
    return res.status(500).json({ error: msg, detail })
  }
}
