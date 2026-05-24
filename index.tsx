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
  'Cross-referencing each answer against the scheme...',
  'Checking for skipped steps and partial credit...',
  'Evaluating logical validity beyond answer key...',
  'Flagging discrepancies by question number...',
  'Compiling your re-evaluation report...',
]

export default function Home() {
  const [markingScheme, setMarkingScheme] = useState('')
  const [questionPaper, setQuestionPaper] = useState('')
  const [totalMarks, setTotalMarks] = useState('')
  const [marksAwarded, setMarksAwarded] = useState('')
  const [answerFile, setAnswerFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  let msgInterval: ReturnType<typeof setInterval>

  const startLoadingMessages = () => {
    let i = 0
    setLoadingMsg(LOADING_MESSAGES[0])
    msgInterval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length
      setLoadingMsg(LOADING_MESSAGES[i])
    }, 3000)
    return msgInterval
  }

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') {
      setAnswerFile(file)
    } else {
      setError('Please upload a PDF file.')
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setAnswerFile(file)
      setError('')
    } else if (file) {
      setError('Please upload a PDF file only.')
    }
  }

  const handleSubmit = async () => {
    if (!markingScheme.trim()) { setError('Please enter the marking scheme.'); return }
    if (!questionPaper.trim()) { setError('Please enter the question paper content.'); return }
    if (!answerFile) { setError('Please upload the scanned answer sheet PDF.'); return }

    setError('')
    setResult(null)
    setLoading(true)

    const interval = startLoadingMessages()

    try {
      const formData = new FormData()
      formData.append('markingScheme', markingScheme)
      formData.append('questionPaper', questionPaper)
      formData.append('totalMarks', totalMarks)
      formData.append('marksAwarded', marksAwarded)
      formData.append('answerSheet', answerFile)

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed. Please try again.')
      }

      setResult(data)
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      clearInterval(interval)
      setLoading(false)
    }
  }

  const handleReset = () => {
    setMarkingScheme('')
    setQuestionPaper('')
    setTotalMarks('')
    setMarksAwarded('')
    setAnswerFile(null)
    setResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const severityLabel: Record<string, string> = {
    critical: 'Definite Error',
    likely: 'Likely Error',
    possible: 'Possible Oversight',
    correct: 'Correctly Marked',
  }

  return (
    <>
      <Head>
        <title>ExamCheck — AI Re-Evaluation Tool</title>
        <meta name="description" content="AI-powered exam re-evaluation. Upload your answer sheet and marking scheme to instantly spot marking errors." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header className="header">
        <div className="header-inner">
          <div className="header-logo">
            <h1>ExamCheck</h1>
            <span className="tagline">Re-evaluation intelligence</span>
          </div>
          <span className="header-badge">Powered by Claude AI</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <h2>
            Catch every marking error
            <br />
            in <span className="accent">minutes</span>, not days.
          </h2>
          <p>
            Upload your marking scheme, question paper, and scanned answer sheet.
            The AI reads your handwriting, checks every step against the scheme,
            and tells you exactly where marks may have been wrongly deducted.
          </p>
          <div className="hero-meta">
            <div className="hero-stat">
              <span className="num">Step-by-step</span>
              <span className="label">Marks verification</span>
            </div>
            <div className="hero-stat">
              <span className="num">Beyond key</span>
              <span className="label">Logic check included</span>
            </div>
            <div className="hero-stat">
              <span className="num">Under 60s</span>
              <span className="label">Full paper analysis</span>
            </div>
          </div>
        </div>
      </section>

      <main className="main-area">
        <div className="container">

          <div className="section-label">Step 1 of 3 — Input your documents</div>

          <div className="step-grid">

            {/* Step 1: Marking Scheme */}
            <div className="step-card">
              <div className="step-num">01</div>
              <div className="step-title">Marking Scheme</div>
              <label className="field-label">
                Paste the official marking scheme
              </label>
              <textarea
                rows={10}
                placeholder={`Example:\nQ1(a) — State Newton's second law. [2 marks]\nAward 1 mark for: Force = mass x acceleration\nAward 1 mark for: correct units (N)\n\nQ1(b) — Calculate force... [3 marks]\nStep 1: Identify values — 1 mark\nStep 2: Substitute in formula — 1 mark\nStep 3: Correct answer with units — 1 mark`}
                value={markingScheme}
                onChange={e => setMarkingScheme(e.target.value)}
              />
            </div>

            {/* Step 2: Question Paper */}
            <div className="step-card">
              <div className="step-num">02</div>
              <div className="step-title">Question Paper</div>
              <label className="field-label">
                Paste question text (for context)
              </label>
              <textarea
                rows={10}
                placeholder={`Example:\nQ1(a) State Newton's second law of motion. [2]\n\nQ1(b) A car of mass 800 kg accelerates at 2 m/s². Calculate the resultant force acting on it. [3]\n\nQ2 Describe the process of photosynthesis... [5]`}
                value={questionPaper}
                onChange={e => setQuestionPaper(e.target.value)}
              />

              <div className="marks-row" style={{ marginTop: '16px' }}>
                <div>
                  <label className="field-label">Total marks possible</label>
                  <input
                    type="number"
                    placeholder="e.g. 80"
                    value={totalMarks}
                    onChange={e => setTotalMarks(e.target.value)}
                    min={0}
                  />
                </div>
                <div>
                  <label className="field-label">Marks awarded by examiner</label>
                  <input
                    type="number"
                    placeholder="e.g. 61"
                    value={marksAwarded}
                    onChange={e => setMarksAwarded(e.target.value)}
                    min={0}
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Answer Sheet Upload */}
            <div className="step-card">
              <div className="step-num">03</div>
              <div className="step-title">Scanned Answer Sheet</div>
              <label className="field-label">Upload PDF (handwritten or typed)</label>
              <div
                className={`upload-zone${dragOver ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
              >
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  ref={fileInputRef}
                />
                <div className="upload-icon">+</div>
                <div className="upload-text">
                  <strong>Drag and drop your PDF here</strong>
                  or click to browse
                </div>
              </div>

              {answerFile && (
                <div className="file-selected">
                  <span>PDF</span>
                  <span>{answerFile.name}</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
                    {(answerFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              )}

              <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(10,10,10,0.03)', borderLeft: '3px solid var(--border)' }}>
                <p style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                  The AI reads handwriting directly from your scan — including messy writing, diagrams, and blurry pages. Higher resolution scans improve accuracy. Examiner marks (cuts, ticks, numbers) written on the sheet are also detected.
                </p>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="submit-area">
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Analysing...' : 'Run Re-evaluation Analysis'}
            </button>
            {result && (
              <button className="btn-secondary" onClick={handleReset}>
                Start New Analysis
              </button>
            )}
            <div className="submit-note">
              Your documents are processed securely and never stored.<br />
              Analysis typically completes in 30 to 60 seconds.
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="error-box" style={{ marginTop: '20px' }}>
              <p>{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="loading-overlay">
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.3rem', fontWeight: 700 }}>
                Analysing your paper
              </div>
              <div className="loading-bar-container">
                <div className="loading-bar" />
              </div>
              <div className="loading-status">{loadingMsg}</div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="results-area" ref={resultsRef}>

              <div className="results-header">
                <h3>Re-evaluation Report</h3>
                <p>AI analysis complete — review each flagged question carefully</p>
              </div>

              <div className="verdict-strip">
                <div className="verdict-cell">
                  <div className="v-num">{result.totalQuestions}</div>
                  <div className="v-label">Questions analysed</div>
                </div>
                <div className="verdict-cell red">
                  <div className="v-num">{result.flaggedCount}</div>
                  <div className="v-label">Questions flagged</div>
                </div>
                <div className="verdict-cell amber">
                  <div className="v-num">
                    {result.potentialMarksDifference > 0 ? '+' : ''}
                    {result.potentialMarksDifference}
                  </div>
                  <div className="v-label">Marks potentially owed</div>
                </div>
                <div className="verdict-cell green">
                  <div className="v-num">{result.confidence}</div>
                  <div className="v-label">Analysis confidence</div>
                </div>
              </div>

              <div className="findings-title">Individual Question Findings</div>

              {result.findings.map((f, i) => (
                <div key={i} className={`finding-card reveal reveal-delay-${(i % 3) + 1}`}>
                  <div className="finding-header">
                    <div className={`finding-severity ${f.severity}`} />
                    <div className="finding-meta">
                      <span className="finding-qnum">Question {f.questionNumber}</span>
                      <span className={`finding-badge ${f.severity}`}>
                        {severityLabel[f.severity]}
                      </span>
                      {f.beyondKeyValid && (
                        <span className="finding-badge possible">
                          Alternative valid approach
                        </span>
                      )}
                      <div className="finding-marks">
                        {f.marksAwarded !== null && (
                          <span className="marks-chip awarded">
                            Awarded: {f.marksAwarded}
                          </span>
                        )}
                        {f.marksDeserved !== null && (
                          <span className="marks-chip should">
                            Should be: {f.marksDeserved}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="finding-body">
                    <p className="finding-issue">{f.issue}</p>
                    <div className="finding-reasoning">
                      <strong>AI Reasoning</strong>
                      {f.reasoning}
                    </div>
                    {f.recommendation && (
                      <div className="finding-recommendation">
                        <strong>What to do</strong>
                        {f.recommendation}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="summary-box">
                <h4>Overall Verdict</h4>
                <p>{result.overallVerdict}</p>
                <div className="summary-verdict">{result.summary}</div>
              </div>

              <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(10,10,10,0.04)', borderLeft: '3px solid var(--border)' }}>
                <p style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                  This report is an AI-assisted analysis intended to help you identify potential errors for re-evaluation requests. It does not constitute a formal academic determination. Cross-check flagged questions with your teacher or institution before filing a formal challenge.
                </p>
              </div>

              <div style={{ marginTop: '24px' }}>
                <button className="btn-secondary" onClick={handleReset}>
                  Start New Analysis
                </button>
              </div>

            </div>
          )}

        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p>ExamCheck — AI Re-evaluation Assistant</p>
          <p>Built for students. Powered by Claude AI.</p>
        </div>
      </footer>
    </>
  )
}
