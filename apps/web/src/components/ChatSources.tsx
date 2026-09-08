import { useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

// Citations are source text, not user-authored Markdown. Rendering it as plain
// text keeps old stored messages and newly generated answers visually stable.
function cleanSourceText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([.#*_()])/g, '$1')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fallbackQuote(value: string, occurrence: number): string {
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  const sourceSegment = paragraphs[Math.min(occurrence, paragraphs.length - 1)] || value.trim()
  if (sourceSegment.length <= 560) return sourceSegment
  const sentences = sourceSegment.split(/(?<=[.!?])\s+(?=[A-Z])/)
  let excerpt = ''
  for (const sentence of sentences) {
    const proposed = `${excerpt} ${sentence}`.trim()
    if (excerpt && proposed.length > 560) break
    excerpt = proposed
  }
  return excerpt || sourceSegment.slice(0, 560).replace(/\s+\S*$/, '').trim()
}

type CitationClaim = { heading: string; excerpt: string; supportingQuotes: string[] }
type ArticleCitation = ChatCitation & {
  articleId: number
  sections: string[]
  originalIds: Set<number>
  claims: CitationClaim[]
}

function normalizedClaims(source: ChatCitation): CitationClaim[] {
  return (source.claims || [])
    .filter((claim) => Boolean(claim) && typeof claim.heading === 'string' && typeof claim.excerpt === 'string')
    .map((claim) => ({
      heading: cleanSourceText(claim.heading),
      excerpt: cleanSourceText(claim.excerpt),
      supportingQuotes: (claim.supporting_quotes || []).filter((quote): quote is string => typeof quote === 'string')
        .map(cleanSourceText).filter(Boolean),
    }))
}

function articleCitations(citations: ChatCitation[]): ArticleCitation[] {
  const byUrl = new Map<string, ArticleCitation>()
  for (const source of citations) {
    const safeUrl = safeSourceUrl(source.url)
    if (!safeUrl) continue
    const current = byUrl.get(safeUrl)
    const sections = (source.sections?.length ? source.sections : [source.heading]).map(cleanSourceText).filter(Boolean)
    if (current) {
      current.originalIds.add(source.id)
      for (const section of sections) if (!current.sections.includes(section)) current.sections.push(section)
      current.claims.push(...normalizedClaims(source))
      continue
    }
    byUrl.set(safeUrl, {
      ...source,
      articleId: byUrl.size + 1,
      url: safeUrl,
      heading: cleanSourceText(source.heading),
      excerpt: cleanSourceText(source.excerpt),
      sections: sections.length ? sections : [cleanSourceText(source.heading)],
      claims: normalizedClaims(source),
      originalIds: new Set([source.id]),
    })
  }
  return [...byUrl.values()]
}

export function ChatSources({ text, citations = [], renderText, onCitationOpen }: {
  text: string
  citations?: ChatCitation[]
  renderText: (text: string, renderCitation: (text: string) => ReactNode) => ReactNode
  onCitationOpen?: () => void
}) {
  const [opened, setOpened] = useState<{ articleId: number; claimIndex: number } | null>(null)
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const popoverId = useId()
  const sourceListId = useId()
  const articles = useMemo(() => articleCitations(Array.isArray(citations) ? citations.filter((source): source is ChatCitation => Boolean(source)
    && Number.isInteger(source.id) && source.id > 0 && typeof source.title === 'string'
    && typeof source.heading === 'string' && typeof source.excerpt === 'string' && typeof source.url === 'string') : []), [citations])
  // Old conversations use [1]; new responses use [1:2] to address the exact
  // proof object for that paragraph without relying on render order.
  const citationOccurrences = new Map<number, number>()

  function openCitation(articleId: number, claimIndex: number) {
    setOpened({ articleId, claimIndex })
    onCitationOpen?.()
  }

  function renderCitation(part: string): ReactNode {
    return part.split(/(\[\d+(?::\d+)?\])/g).map((piece, index) => {
      const match = /^\[(\d+)(?::(\d+))?\]$/.exec(piece)
      const article = match ? articles.find((row) => row.originalIds.has(Number(match[1]))) : null
      if (!match || !article) return piece
      const legacyClaimIndex = citationOccurrences.get(article.articleId) || 0
      citationOccurrences.set(article.articleId, legacyClaimIndex + 1)
      const claimIndex = match[2] ? Math.max(0, Number(match[2]) - 1) : legacyClaimIndex
      const claim = article.claims[claimIndex] || { heading: article.heading, excerpt: article.excerpt, supportingQuotes: [] }
      const hasExactProof = claim.supportingQuotes.length > 0
      const supportingQuotes = hasExactProof ? claim.supportingQuotes : [fallbackQuote(claim.excerpt, claimIndex)]
      const isOpen = opened?.articleId === article.articleId && opened.claimIndex === claimIndex
      return <span className="chat-source-popover" key={index}>
        <button type="button" className="chat-source-ref"
          aria-label={`Lihat sumber NEI: ${article.title}`}
          aria-expanded={isOpen} aria-controls={popoverId}
          onMouseEnter={() => openCitation(article.articleId, claimIndex)}
          onFocus={() => openCitation(article.articleId, claimIndex)}
          onKeyDown={(event) => { if (event.key === 'Escape') setOpened(null) }}
          onClick={() => setOpened((current) => {
            const next = current?.articleId === article.articleId && current.claimIndex === claimIndex
              ? null : { articleId: article.articleId, claimIndex }
            if (next !== null) onCitationOpen?.()
            return next
          })}>
          NEI<sup>{article.articleId}</sup>
        </button>
        {isOpen && typeof document !== 'undefined' && createPortal(<>
          {/* This transparent layer makes outside-click dismissal work on every
              viewport without dimming the conversation behind the source card. */}
          <div className="chat-source-popover__backdrop" aria-hidden="true" onPointerDown={() => setOpened(null)} />
          <section id={popoverId} className="chat-source-popover__card" role="dialog" aria-label={`Sumber ${article.title}`}
            onMouseEnter={() => setOpened({ articleId: article.articleId, claimIndex })}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpened(null) }}>
            <div className="chat-source-popover__head"><strong>{article.title}</strong>
              <button type="button" onClick={() => setOpened(null)} aria-label="Tutup sumber">×</button></div>
            <p className="chat-source-popover__sections">{hasExactProof
              ? `Bagian sumber yang mendasari klaim ini: ${claim.heading || article.sections.join(' · ')}`
              : `Bagian artikel terkait: ${claim.heading || article.sections.join(' · ')}`}</p>
            <p className="chat-source-popover__evidence-label">{hasExactProof ? 'Kutipan sumber yang mendasari klaim' : 'Cuplikan artikel untuk riwayat percakapan ini'}</p>
            {supportingQuotes.filter(Boolean).map((quote, quoteIndex) => <blockquote className={`chat-source-popover__quote${hasExactProof ? '' : ' chat-source-popover__quote--legacy'}`} lang="en" key={quoteIndex}>{quote}</blockquote>)}
            <a href={article.url} target="_blank" rel="noopener noreferrer">Baca artikel NEI ↗</a>
          </section>
        </>, document.body)}
      </span>
    })
  }

  return <>
    {renderText(text, renderCitation)}
    {articles.length > 0 && <section className="chat-sources" aria-label="Referensi National Eye Institute">
      <button type="button" className="chat-sources__toggle" aria-expanded={sourcesExpanded} aria-controls={sourceListId}
        onClick={() => setSourcesExpanded((expanded) => !expanded)}>
        <span>Referensi: National Eye Institute · {articles.length} artikel</span>
        <span className="chat-sources__chevron" aria-hidden="true">⌄</span>
      </button>
      {sourcesExpanded && <ul className="chat-sources__list" id={sourceListId}>
        {articles.map((article) => <li key={article.articleId}>
          <span className="chat-sources__number">NEI<sup>{article.articleId}</sup></span>
          <span className="chat-sources__entry">
            <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a>
            <span>Bagian relevan: {article.sections.join(' · ')}</span>
          </span>
        </li>)}
      </ul>}
    </section>}
  </>
}
