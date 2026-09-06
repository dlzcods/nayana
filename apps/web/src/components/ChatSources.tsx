import { useId, useState, type ReactNode } from 'react'
import type { ChatCitation } from '../lib/screening-api'

const approvedPaths = new Set([
  '/eye-health-information/healthy-vision/how-eyes-work/keep-your-eyes-healthy',
  '/eye-health-information/healthy-vision/8-things-you-can-do-right-now-protect-your-vision',
  '/eye-health-information/eye-conditions-and-diseases/cataracts',
  '/eye-health-information/eye-conditions-and-diseases/diabetic-retinopathy',
  '/eye-health-information/eye-conditions-and-diseases/glaucoma',
])

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.nei.nih.gov'
      && !url.port && !url.username && !url.password && !url.search && !url.hash && approvedPaths.has(url.pathname)
      ? url.href : null
  } catch { return null }
}

export function ChatSources({ text, citations = [], renderText }: {
  text: string
  citations?: ChatCitation[]
  renderText: (text: string, renderCitation: (text: string) => ReactNode) => ReactNode
}) {
  const [opened, setOpened] = useState<number | null>(null)
  const panelId = useId()
  const valid = (Array.isArray(citations) ? citations : []).filter((source) => source
    && Number.isInteger(source.id) && source.id > 0
    && typeof source.title === 'string' && typeof source.heading === 'string'
    && typeof source.excerpt === 'string' && typeof source.url === 'string' && safeSourceUrl(source.url))
  const selected = valid.find((source) => source.id === opened)
  function renderCitation(part: string): ReactNode {
    return part.split(/(\[\d+\])/g).map((piece, index) => {
      const match = /^\[(\d+)\]$/.exec(piece)
      const source = match ? valid.find((row) => row.id === Number(match[1])) : null
      if (!source) return piece
      return <button type="button" className="chat-source-ref" key={index}
        aria-label={`Sumber ${source.id}: ${source.title}`}
        aria-expanded={opened === source.id} aria-controls={panelId}
        onClick={() => setOpened((current) => current === source.id ? null : source.id)}>[{source.id}]</button>
    })
  }
  return <>
    {renderText(text, renderCitation)}
    {valid.length > 0 && <div className="chat-sources">
      <p className="chat-sources__label">Rujukan: National Eye Institute · {new Set(valid.map((source) => source.url)).size} artikel</p>
      <div id={panelId}>
        {selected && <section className="chat-sources__panel" aria-label="Detail sumber">
          <div className="chat-sources__head"><strong>{selected.title}</strong>
            <button type="button" onClick={() => setOpened(null)} aria-label="Tutup detail sumber">×</button></div>
          <p>{selected.heading}</p>
          <p className="chat-sources__label">Potongan sumber asli (bahasa Inggris)</p>
          <blockquote lang="en">{selected.excerpt}</blockquote>
          <a href={safeSourceUrl(selected.url)!} target="_blank" rel="noopener noreferrer">Baca artikel NEI ↗</a>
          {selected.source_updated_at && <p className="chat-sources__label">Pembaruan artikel: {selected.source_updated_at}</p>}
          <p className="chat-sources__label">Courtesy: NEI/NIH. Jawaban AI bukan penilaian atau dukungan resmi NEI.</p>
        </section>}
      </div>
    </div>}
  </>
}
