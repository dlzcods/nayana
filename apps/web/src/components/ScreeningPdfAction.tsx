import { useState } from 'react'
import { downloadScreeningPdf, type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'

type ScreeningPdfActionProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
}

export function ScreeningPdfAction({ screening, summary }: ScreeningPdfActionProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setState('loading')
    setError(null)
    try {
      const blob = await downloadScreeningPdf({ screening, summary })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'nayana-ringkasan-skrining.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PDF belum dapat dibuat.')
    } finally {
      setState('idle')
    }
  }

  return (
    <div className="screening-pdf">
      <button className="app-secondary-action" type="button" onClick={() => { void download() }} disabled={state === 'loading'}>
        {state === 'loading' ? 'Menyiapkan PDF…' : 'Unduh ringkasan PDF'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
