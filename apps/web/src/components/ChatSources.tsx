import { useId, useMemo, useState, type ReactNode } from 'react'
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

type ArticleCitation = ChatCitation & { articleId: number; sections: string[]; originalIds: Set<number> }

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
      continue
    }
    byUrl.set(safeUrl, {
      ...source,
      articleId: byUrl.size + 1,
      url: safeUrl,
      heading: cleanSourceText(source.heading),
      excerpt: cleanSourceText(source.excerpt),
      sections: sections.length ? sections : [cleanSourceText(source.heading)],
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
  const [opened, setOpened] = useState<number | null>(null)
  const popoverId = useId()
  const articles = useMemo(() => articleCitations(Array.isArray(citations) ? citations.filter((source): source is ChatCitation => Boolean(source)
    && Number.isInteger(source.id) && source.id > 0 && typeof source.title === 'string'
    && typeof source.heading === 'string' && typeof source.excerpt === 'string' && typeof source.url === 'string') : []), [citations])
  const shownArticles = new Set<number>()

  function openCitation(articleId: number) {
    setOpened(articleId)
    onCitationOpen?.()
  }

  function renderCitation(part: string): ReactNode {
    return part.split(/(\[\d+\])/g).map((piece, index) => {
      const match = /^\[(\d+)\]$/.exec(piece)
      const article = match ? articles.find((row) => row.originalIds.has(Number(match[1]))) : null
      if (!article) return piece
      // Multiple chunks from one article formerly rendered as [1][2]. Present
      // one compact article reference at its first relevant claim instead.
      if (shownArticles.has(article.articleId)) return null
      shownArticles.add(article.articleId)
      const isOpen = opened === article.articleId
      return <span className="chat-source-popover" key={index} onMouseLeave={() => setOpened(null)}>
        <button type="button" className="chat-source-ref"
          aria-label={`Lihat sumber NEI: ${article.title}`}
          aria-expanded={isOpen} aria-controls={popoverId}
          onMouseEnter={() => openCitation(article.articleId)}
          onFocus={() => openCitation(article.articleId)}
          onKeyDown={(event) => { if (event.key === 'Escape') setOpened(null) }}
          onClick={() => setOpened((current) => {
            const next = current === article.articleId ? null : article.articleId
            if (next !== null) onCitationOpen?.()
            return next
          })}>
          NEI<sup>{article.articleId}</sup>
        </button>
        {isOpen && <section id={popoverId} className="chat-source-popover__card" role="dialog" aria-label={`Sumber ${article.title}`}
          onMouseEnter={() => setOpened(article.articleId)}>
          <div className="chat-source-popover__head"><strong>{article.title}</strong>
            <button type="button" onClick={() => setOpened(null)} aria-label="Tutup sumber">×</button></div>
          <p className="chat-source-popover__sections">Bagian relevan: {article.sections.join(' · ')}</p>
          <blockquote lang="en">{article.excerpt}</blockquote>
          <a href={article.url} target="_blank" rel="noopener noreferrer">Baca artikel NEI ↗</a>
        </section>}
      </span>
    })
  }

  return <>
    {renderText(text, renderCitation)}
    {articles.length > 0 && <p className="chat-sources__label">Rujukan: National Eye Institute · {articles.length} artikel</p>}
  </>
}
