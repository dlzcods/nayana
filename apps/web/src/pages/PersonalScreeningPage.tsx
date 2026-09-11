import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { ExecutiveSummaryCard } from '../components/ExecutiveSummaryCard'
import { ScreeningChat } from '../components/ScreeningChat'
import { ScreeningFinalizing } from '../components/ScreeningFinalizing'
import { ScreeningPdfAction } from '../components/ScreeningPdfAction'
import { ScreeningSaveActions } from '../components/ScreeningSaveActions'
import { DiscussionKit } from '../components/DiscussionKit'
import { ResultPathway } from '../components/ResultPathway'
import {
  getExecutiveSummary,
  getDemoCases,
  startDemoScreening,
  startUploadedScreening,
  type DemoCase,
  type ExecutiveSummary,
  type ScreeningResult,
} from '../lib/screening-api'

const acceptedFileTypes = ['image/jpeg', 'image/png', 'image/webp']

async function createNormalizedPreview(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const longestSide = Math.max(bitmap.width, bitmap.height)
  const scale = Math.min(1, 2048 / longestSide)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = width
  canvas.height = height
  if (!context) {
    bitmap.close()
    throw new Error('Preview gambar tidak dapat dibuat.')
  }

  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.96)
  })
  if (!blob) throw new Error('Preview gambar tidak dapat dibuat.')

  return { url: URL.createObjectURL(blob), blob }
}

type PersonalScreeningPanelProps = {
  onProcessingChange?: (isProcessing: boolean) => void
}

export function PersonalScreeningPanel({ onProcessingChange }: PersonalScreeningPanelProps) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadedResultRef = useRef<HTMLElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [normalizedImage, setNormalizedImage] = useState<Blob | null>(null)
  const [cases, setCases] = useState<DemoCase[]>([])
  const [selectedDemoId, setSelectedDemoId] = useState('')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [processingConsent, setProcessingConsent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [screeningResult, setScreeningResult] = useState<ScreeningResult | null>(null)
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDestination, setSavedDestination] = useState<{ kind: 'account'; recordId: string } | { kind: 'browser' } | null>(null)
  const [discussionQuestions, setDiscussionQuestions] = useState<string[]>([])

  const selectedDemo = cases.find((item) => item.id === selectedDemoId) || null
  const usingDemo = selectedDemo !== null

  useEffect(() => {
    onProcessingChange?.(isSubmitting)
  }, [isSubmitting, onProcessingChange])

  useEffect(() => {
    if (!screeningResult || !uploadedResultRef.current) return
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: Math.max(0, uploadedResultRef.current!.offsetTop - 104), behavior: 'auto' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [screeningResult])

  useEffect(() => {
    let active = true
    getDemoCases()
      .then((response) => {
        if (active) setCases(response)
      })
      .catch(() => {
        if (active) setError('Contoh fundus belum dapat dimuat. Anda tetap dapat mengunggah foto sendiri.')
      })

    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null)
      setNormalizedImage(null)
      return undefined
    }

    let active = true
    let objectUrl: string | null = null

    void createNormalizedPreview(image)
      .then((preview) => {
        objectUrl = preview.url
        if (active) {
          setPreviewUrl(preview.url)
          setNormalizedImage(preview.blob)
          return
        }
        URL.revokeObjectURL(preview.url)
      })
      .catch(() => {
        if (active) setNormalizedImage(null)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [image])

  function confirmReplacingUnsavedResult() {
    if (!screeningResult || savedDestination) return true
    return window.confirm('Hasil skrining ini belum disimpan. Ganti foto dan hapus hasil saat ini?')
  }

  function resetScreening() {
    if (!confirmReplacingUnsavedResult()) return
    setImage(null)
    setNormalizedImage(null)
    setSelectedDemoId('')
    setAgeConfirmed(false)
    setProcessingConsent(false)
    setScreeningResult(null)
    setSummary(null)
    setSummaryError(null)
    setSavedDestination(null)
    setDiscussionQuestions([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    if (!confirmReplacingUnsavedResult()) {
      event.target.value = ''
      return
    }
    const nextFile = event.target.files?.[0] || null
    setScreeningResult(null)
    setSummary(null)
    setSummaryError(null)
    setSavedDestination(null)
    setDiscussionQuestions([])
    setError(null)

    if (!nextFile) {
      setImage(null)
      setNormalizedImage(null)
      return
    }
    if (!acceptedFileTypes.includes(nextFile.type)) {
      setImage(null)
      setError('Gunakan file JPG, PNG, atau WEBP.')
      event.target.value = ''
      return
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setImage(null)
      setError('Ukuran foto melebihi batas 10 MB.')
      event.target.value = ''
      return
    }

    setSelectedDemoId('')
    setImage(nextFile)
  }

  function selectDemo(caseId: string) {
    if (!confirmReplacingUnsavedResult()) return
    setSelectedDemoId(caseId)
    setImage(null)
    setNormalizedImage(null)
    setAgeConfirmed(false)
    setProcessingConsent(false)
    setScreeningResult(null)
    setSummary(null)
    setSummaryError(null)
    setSavedDestination(null)
    setDiscussionQuestions([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submitScreening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!image && !selectedDemo) return
    if (!usingDemo && (!ageConfirmed || !processingConsent)) return

    // The compact loading state replaces a long form. Resetting first prevents
    // the browser from retaining a stale lower-page scroll position.
    window.scrollTo({ top: 0, behavior: 'auto' })
    setIsSubmitting(true)
    setScreeningResult(null)
    setError(null)
    try {
      if (selectedDemo) {
        const result = await startDemoScreening(selectedDemo.id)
        await navigate({
          to: '/screening/results/$screeningId',
          params: { screeningId: result.screening_id },
        })
        return
      }

      if (image) {
        const result = await startUploadedScreening(image, ageConfirmed, processingConsent)
        let nextSummary: ExecutiveSummary | null = null
        let nextSummaryError: string | null = null

        try {
          nextSummary = await getExecutiveSummary(result)
        } catch (reason) {
          nextSummaryError = reason instanceof Error ? reason.message : 'Ringkasan belum tersedia.'
        }

        setScreeningResult(result)
        setSummary(nextSummary)
        setSummaryError(nextSummaryError)
        setDiscussionQuestions([])
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Skrining foto belum dapat dijalankan. Silakan coba lagi.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {isSubmitting ? (
        <section className="app-upload__section app-upload__section--finalizing" aria-label="Menyiapkan hasil skrining">
          <ScreeningFinalizing
            source={usingDemo ? 'demo' : 'upload'}
            imageUrl={usingDemo ? selectedDemo?.image_url : previewUrl || undefined}
          />
        </section>
      ) : screeningResult && previewUrl ? (
        <section className="app-upload__result" aria-labelledby="uploaded-result-title">
          <div className="app-section-label">
            <span>02</span>
            <h2 id="uploaded-result-title">Hasil skrining awal</h2>
          </div>

          <section ref={uploadedResultRef} className="screening-result" aria-label="Rincian hasil skrining foto Anda">
            <figure className="screening-result__image">
              <img src={previewUrl} alt="Foto fundus yang dianalisis" />
              <figcaption>Preview lokal foto yang Anda pilih.</figcaption>
            </figure>

            <div className="screening-result__data">
              <p className="screening-result__eyebrow">Indikasi model</p>
              <h2>Pola paling mirip dengan {screeningResult.top_prediction.label.toLowerCase()}.</h2>
              <div className="screening-result__rows" aria-label="Perbandingan kemiripan pola">
                {screeningResult.predictions.map((prediction, index) => (
                  <div className={index === 0 ? 'screening-row screening-row--primary' : 'screening-row'} key={prediction.key}>
                    <span>{prediction.label}</span>
                    <i aria-hidden="true"><b style={{ width: `${Math.round(prediction.score * 100)}%` }} /></i>
                    <strong>{Math.round(prediction.score * 100)}%</strong>
                  </div>
                ))}
              </div>
            </div>

            <ExecutiveSummaryCard screening={screeningResult} summary={summary} error={summaryError} />

            <ScreeningChat screening={screeningResult} summary={summary} savedDestination={savedDestination} />

            <div className="result-utilities">
              <ScreeningSaveActions result={screeningResult} summary={summary} normalizedImage={normalizedImage} onSaved={setSavedDestination} />
              <ScreeningPdfAction screening={screeningResult} summary={summary} discussionQuestions={discussionQuestions} />
            </div>

            <DiscussionKit screening={screeningResult} selectedQuestions={discussionQuestions} onChange={setDiscussionQuestions} />

            <ResultPathway action={
              <button className="app-primary-action app-primary-action--back" type="button" onClick={resetScreening}>
                <BackArrowIcon />
                Pilih foto atau contoh lain
              </button>
            } />

            <p className="screening-result__disclaimer">{screeningResult.disclaimer}</p>
          </section>
        </section>
      ) : (
        <section className="app-upload__section" aria-labelledby="upload-form-title">
          <div className="app-section-label">
            <span>01</span>
            <h2 id="upload-form-title">Pilih foto fundus</h2>
          </div>

          <form className="upload-form" onSubmit={submitScreening}>
            <label className={previewUrl ? 'upload-file upload-file--has-preview' : 'upload-file'} htmlFor="fundus-upload">
              <span className="upload-file__content">
                <span className="upload-file__eyebrow">Foto Anda</span>
                <strong>{image ? image.name : 'Unggah foto fundus'}</strong>
                <small>JPG, PNG, atau WEBP · maksimal 10 MB</small>
              </span>
              {previewUrl && (
                <span className="upload-preview">
                  <img src={previewUrl} alt="Foto fundus yang dipilih" />
                </span>
              )}
              <input
                ref={fileInputRef}
                id="fundus-upload"
                name="fundus-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectFile}
                disabled={isSubmitting}
              />
            </label>

            <section className="demo-picker" aria-labelledby="demo-picker-title">
              <div className="demo-picker__head">
                <div>
                  <span>Atau gunakan contoh</span>
                  <p id="demo-picker-title">Pilih satu contoh fundus untuk mencoba alur NAYANA tanpa foto pribadi.</p>
                </div>
                <label>
                  <span className="sr-only">Pilih contoh fundus</span>
                  <select value={selectedDemoId} onChange={(event) => selectDemo(event.target.value)} disabled={isSubmitting}>
                    <option value="">Pilih contoh</option>
                    {cases.map((demoCase) => <option key={demoCase.id} value={demoCase.id}>{demoCase.title}</option>)}
                  </select>
                </label>
              </div>

              <div className="demo-carousel" aria-label="Carousel contoh fundus">
                {cases.map((demoCase, index) => (
                  <button
                    className={selectedDemoId === demoCase.id ? 'is-selected' : ''}
                    key={demoCase.id}
                    type="button"
                    aria-pressed={selectedDemoId === demoCase.id}
                    onClick={() => selectDemo(demoCase.id)}
                    disabled={isSubmitting}
                  >
                    <img src={demoCase.image_url} alt={`Preview ${demoCase.title}`} />
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </button>
                ))}
              </div>
              <p className="demo-picker__flow" aria-label="Alur mode contoh">Pilih contoh → lihat hasil → baca ringkasan → siapkan diskusi → unduh PDF</p>
              {selectedDemo && <p className="demo-picker__selected">{selectedDemo.title} dipilih untuk mode contoh.</p>}
            </section>

            <div className={usingDemo ? 'upload-consents is-exempt' : 'upload-consents'}>
              <label className="upload-check">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                  disabled={usingDemo || isSubmitting}
                />
                <span>Saya berusia 18 tahun atau lebih.</span>
              </label>

              <label className="upload-check">
                <input
                  type="checkbox"
                  checked={processingConsent}
                  onChange={(event) => setProcessingConsent(event.target.checked)}
                  disabled={usingDemo || isSubmitting}
                />
                <span>
                  Saya memahami foto dibersihkan dari metadata lalu dikirim ke model untuk skrining awal.
                  Foto tidak disimpan pada tahap ini.
                </span>
              </label>
              {usingDemo && <p>Persetujuan ini tidak diperlukan untuk contoh fundus.</p>}
            </div>

            <button
              className="app-primary-action"
              type="submit"
              disabled={isSubmitting || (!image && !selectedDemo) || (!usingDemo && (!ageConfirmed || !processingConsent))}
            >
              {isSubmitting ? 'Menganalisis foto…' : usingDemo ? 'Mulai skrining contoh' : 'Mulai skrining foto'}
            </button>
          </form>

          {error && (
            <div className="app-message" role="alert">
              <strong>Skrining belum dapat dilanjutkan.</strong>
              <p>{error}</p>
            </div>
          )}
        </section>
      )}

      {!isSubmitting && (
        <aside className="app-boundary" aria-label="Privasi pemeriksaan foto">
          <span>Privasi singkat</span>
          <p>
            Foto pribadi diproses untuk skrining awal pada sesi ini. Bila Anda memilih menyimpan hasil setelah
            masuk akun, foto disimpan privat selama masa simpan yang Anda pilih. Contoh fundus berasal dari data uji
            dataset sumber dan tidak memuat data pribadi pengguna.
          </p>
          <a href="/trust">Lihat privasi & cara kerja data</a>
        </aside>
      )}
    </>
  )
}
