import { useState } from 'react'
import { downloadScreeningPdf, type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'

type ScreeningPdfActionProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  className?: string
  imageUrl?: string | null
  imageDownloadName?: string
  imageDownloadLabel?: string
  showImageOptions?: boolean
}

const maxPdfAttachmentBytes = 10 * 1024 * 1024

export function ScreeningPdfAction({
  screening,
  summary,
  className,
  imageUrl,
  imageDownloadName = 'nayana-foto-fundus.jpg',
  imageDownloadLabel = 'Unduh foto fundus',
  showImageOptions = false,
}: ScreeningPdfActionProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [includeImage, setIncludeImage] = useState(false)
  const [imageState, setImageState] = useState<'idle' | 'loading'>('idle')

  async function download() {
    setState('loading')
    setError(null)
    try {
      let fundusImage: Blob | undefined
      if (includeImage && imageUrl) {
        const imageResponse = await fetch(imageUrl)
        if (!imageResponse.ok) throw new Error('Foto fundus belum dapat dimuat untuk PDF.')
        const imageBlob = await imageResponse.blob()
        if (imageBlob.size > maxPdfAttachmentBytes) throw new Error('Foto fundus melebihi batas 10 MB untuk lampiran PDF.')
        fundusImage = imageBlob
      }
      const blob = await downloadScreeningPdf({ screening, summary, fundusImage })
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

  async function downloadImage() {
    if (!imageUrl) return
    setImageState('loading')
    setError(null)
    try {
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error('Foto fundus belum dapat diunduh.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = imageDownloadName
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Foto fundus belum dapat diunduh.')
    } finally {
      setImageState('idle')
    }
  }

  return (
    <div className={['screening-pdf', className].filter(Boolean).join(' ')}>
      {showImageOptions && (
        <div className="screening-pdf__options">
          {imageUrl ? (
            <>
          <label className="screening-pdf__include">
            <input type="checkbox" checked={includeImage} onChange={(event) => setIncludeImage(event.target.checked)} />
            <span>
              <strong>Sertakan foto fundus pada PDF</strong>
              <small>Foto dikirim kembali hanya untuk dibuat sebagai lampiran PDF yang Anda unduh.</small>
            </span>
          </label>
          <button className="app-text-action" type="button" onClick={() => { void downloadImage() }} disabled={imageState === 'loading'}>
            {imageState === 'loading' ? 'Menyiapkan foto…' : imageDownloadLabel}
          </button>
            </>
          ) : (
            <p className="screening-pdf__unavailable">Foto tidak tersimpan atau belum dapat dimuat, sehingga PDF dibuat tanpa lampiran foto.</p>
          )}
        </div>
      )}
      <button className="app-secondary-action" type="button" onClick={() => { void download() }} disabled={state === 'loading'}>
        {state === 'loading' ? 'Menyiapkan PDF…' : 'Unduh ringkasan PDF'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
