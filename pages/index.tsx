import Head from 'next/head'
import { useState, useRef, DragEvent, ChangeEvent } from 'react'

interface Finding {
  questionNumber: string
  severity: 'critical' | 'likely' | 'possible' | 'correct'
  issueTitle: string
  issue: string
  reasoning: string
  recommendation: string
  marksAwarded: number | null
  marksDeserved: number | null
  beyondKeyValid?: boolean
}

interface AnalysisResult {
  totalQuestions: number
  flaggedCount: number
  potentialMarksDifference: number
  overallVerdict: string
  findings: Finding[]
  summary: string
  confidence: string
}

const LOADING_MESSAGES = [
  'Reading your handwritten answer sheet...',
  'Parsing marking scheme structure...',
  'Cross-referencing answers against the scheme...',
  'Checking for skipped steps and partial credit...',
  'Evaluating logical validity beyond answer key...',
  'Flagging discrepancies by question number...',
  'Compiling your re-evaluation report...',
]

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Definite Error',
  likely: 'Likely Error',
  possible: 'Possible Oversight',
  correct: 'Correctly Marked',
}

interface UploadCardProps {
  num: string
  label: string
  title: string
  hint: string
  file: File | null
  onFile: (f: File) => void
  onError: (msg: string) => void
  extraContent?: React.ReactNode
}

function UploadCard({ num, label, title, hint, file, onFile, onError, extraContent }: UploadCardProps) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type === 'application/pdf') { onFile(f) }
    else { onError('Please upload a PDF file.') }
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && f.type === 'application/pdf') { onFile(f) }
    else if (f) { onError('Only PDF files are accepted.') }
  }

  return (
    <div className="upload-card">
      <div className="card-label">{num} — {label}</div>
      <div className="card-title">{title}</div>

      <div
        className={`upload-zone${drag ? ' drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
      >
        <input type="file" accept=".pdf" onChange={handleChange} ref={inputRef} />
        <div className="upload-icon-wrap">
          <svg className="upload-icon-svg" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <span className="upload-main-text">Drop PDF here</span>
        <span className="upload-sub-text">or click to browse</span>
      </div>

      {file && (
        <div className="file-pill">
          <span className="file-pill-name">{file.name}</span>
          <span className="file-pill-size">{(file.size / 1024).toFixed(0)} KB</span>
        </div>
      )}

      {extraContent}

      <div className="card-hint">{hint}</div>
    </div>
  )
}

export default function Home() {
  const [schemeFile, setSchemeFile] = useState<File | null>(null)
  const [paperFile, setPaperFile] = useState<File | null>(null)
  const [answerFile, setAnswerFile] = useState<File | null>(null)
  const [totalMarks, setTotalMarks] = useState('')
  const [marksAwarded, setMarksAwarded] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)

  const handleSubmit = async () => {
    if (!schemeFile) { setError('Please upload the marking scheme PDF.'); return }
    if (!paperFile) { setError('Please upload the question paper PDF.'); return }
    if (!answerFile) { setError('Please upload the answer sheet PDF.'); return }

    setError('')
    setResult(null)
    setLoading(true)

    let i = 0
    setLoadingMsg(LOADING_MESSAGES[0])
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length
      setLoadingMsg(LOADING_MESSAGES[i])
    }, 3000)

    try {
      const formData = new FormData()
      formData.append('schemeFile', schemeFile)
      formData.append('paperFile', paperFile)
      formData.append('answerSheet', answerFile)
      formData.append('totalMarks', totalMarks)
      formData.append('marksAwarded', marksAwarded)

      const response = await fetch('/api/analyze', { method: 'POST', body: formData })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Analysis failed. Please try again.')

      setResult(data)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      clearInterval(interval)
      setLoading(false)
    }
  }

  const handleReset = () => {
    setSchemeFile(null)
    setPaperFile(null)
    setAnswerFile(null)
    setTotalMarks('')
    setMarksAwarded('')
    setResult(null)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <Head>
        <title>ExamCheck — AI Re-Evaluation Tool</title>
        <meta name="description" content="AI-powered exam re-evaluation. Upload your PDFs and instantly spot marking errors." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className="header">
        <div className="header-inner">
          <div className="header-logo">
            <div className="logo-mark">EC</div>
            <h1>ExamCheck</h1>
          </div>
          <span className="header-badge">Powered by Claude AI</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-label">AI Re-evaluation Tool</div>
          <h2>
            Catch marking errors<br />
            in <span className="accent">seconds.</span>
          </h2>
          <p>
            Upload your marking scheme, question paper, and scanned answer sheet as PDFs.
            The AI reads your handwriting and tells you exactly where marks were wrongly deducted.
          </p>
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="num">Step-by-step</span>
              <span className="lbl">Marks check</span>
            </div>
            <div className="hero-stat">
              <span className="num">Beyond key</span>
              <span className="lbl">Logic check</span>
            </div>
            <div className="hero-stat">
              <span className="num">Under 60s</span>
              <span className="lbl">Full analysis</span>
            </div>
          </div>
        </div>
      </section>

      <main className="main-area">
        <div className="container">

          <div className="section-header">
            <span className="section-num">01</span>
            <span className="section-title">Upload your documents</span>
          </div>

          <div className="upload-grid">
            <UploadCard
              num="01"
              label="Required"
              title="Marking Scheme"
              hint="Upload the official marking scheme PDF. The more detailed it is, the better the analysis."
              file={schemeFile}
              onFile={f => { setSchemeFile(f); setError('') }}
              onError={setError}
            />

            <UploadCard
              num="02"
              label="Required"
              title="Question Paper"
              hint="Upload the question paper PDF. This gives the AI context for what each question is asking."
              file={paperFile}
              onFile={f => { setPaperFile(f); setError('') }}
              onError={setError}
              extraContent={
                <div className="marks-row">
                  <div>
                    <label className="input-label">Total marks</label>
                    <input type="number" placeholder="e.g. 80" value={totalMarks} onChange={e => setTotalMarks(e.target.value)} min={0} />
                  </div>
                  <div>
                    <label className="input-label">Marks awarded</label>
                    <input type="number" placeholder="e.g. 61" value={marksAwarded} onChange={e => setMarksAwarded(e.target.value)} min={0} />
                  </div>
                </div>
              }
            />

            <UploadCard
              num="03"
              label="Required"
              title="Answer Sheet"
              hint="Upload your scanned handwritten answer sheet as PDF. Works with blurry scans, messy writing, and diagrams."
              file={answerFile}
              onFile={f => { setAnswerFile(f); setError('') }}
              onError={setError}
            />
          </div>

          <div className="submit-bar">
            <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Analysing...' : 'Run Re-evaluation Analysis'}
            </button>
            {result && (
              <button className="btn-secondary" onClick={handleReset}>
                New Analysis
              </button>
            )}
            <div className="submit-note">
              Documents are processed securely and never stored.<br />
              Analysis completes in 30 to 60 seconds.
            </div>
          </div>

          {error && (
            <div className="error-box">
              <p>{error}</p>
            </div>
          )}

          {loading && (
            <div className="loading-overlay">
              <div className="loading-title">Analysing your paper</div>
              <div className="loading-track">
                <div className="loading-fill" />
              </div>
              <div className="loading-msg">{loadingMsg}</div>
            </div>
          )}

          {result && (
            <div className="results-area" ref={resultsRef}>
              <div className="results-header">
                <h3>Re-evaluation Report</h3>
                <p>Analysis complete — review each flagged question below</p>
              </div>

              <div className="verdict-grid">
                <div className="verdict-card accent">
                  <div className="v-num">{result.totalQuestions}</div>
                  <div className="v-lbl">Questions analysed</div>
                </div>
                <div className="verdict-card red">
                  <div className="v-num">{result.flaggedCount}</div>
                  <div className="v-lbl">Flagged questions</div>
                </div>
                <div className="verdict-card amber">
                  <div className="v-num">{result.potentialMarksDifference > 0 ? '+' : ''}{result.potentialMarksDifference}</div>
                  <div className="v-lbl">Marks potentially owed</div>
                </div>
                <div className="verdict-card green">
                  <div className="v-num">{result.confidence}</div>
                  <div className="v-lbl">Confidence level</div>
                </div>
              </div>

              <div className="findings-label">Individual findings</div>

              {result.findings.map((f, i) => (
                <div key={i} className="finding-card">
                  <div className="finding-top">
                    <div className={`severity-dot ${f.severity}`} />
                    <span className="finding-qnum">Question {f.questionNumber}</span>
                    <span className={`badge ${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                    {f.beyondKeyValid && <span className="badge alt">Alt. valid approach</span>}
                    <div className="marks-tags">
                      {f.marksAwarded !== null && <span className="mark-tag awarded">Awarded: {f.marksAwarded}</span>}
                      {f.marksDeserved !== null && <span className="mark-tag deserved">Should be: {f.marksDeserved}</span>}
                    </div>
                  </div>
                  <div className="finding-body">
                    <p className="finding-issue">{f.issue}</p>
                    <div className="reasoning-block">
                      <span className="reasoning-label">AI Reasoning</span>
                      <span className="reasoning-text">{f.reasoning}</span>
                    </div>
                    {f.recommendation && (
                      <div className="recommendation-block">
                        <span className="recommendation-label">What to do</span>
                        <span className="recommendation-text">{f.recommendation}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="summary-card">
                <h4>Overall Verdict</h4>
                <p className="verdict-text">{result.overallVerdict}</p>
                <div className="next-steps">{result.summary}</div>
              </div>

              <div className="disclaimer">
                This is an AI-assisted analysis to help identify potential errors. It does not constitute a formal academic determination.
                Always cross-check flagged questions with your teacher before filing a formal re-evaluation request.
              </div>

              <div style={{ marginTop: '24px' }}>
                <button className="btn-secondary" onClick={handleReset}>Start New Analysis</button>
              </div>
            </div>
          )}

        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p>ExamCheck — AI Re-evaluation Assistant</p>
          <p>Powered by Claude AI</p>
        </div>
      </footer>
    </>
  )
}
