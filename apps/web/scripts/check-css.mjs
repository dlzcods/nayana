import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const sourceRoot = path.resolve('src')
const landingPageStylesheet = path.join(sourceRoot, 'hero-preview.css')

const stylesheetOwnership = [
  {
    name: 'landing-page .optic-* selectors',
    owner: landingPageStylesheet,
    selectorPattern: /\.optic-[\w-]+\b/g,
  },
]

const sectionOwnership = [
  {
    name: 'Section 03 result visualization',
    owner: landingPageStylesheet,
    startMarker: 'SECTION 03: RESULT VISUALIZATION',
    endMarker: 'SECTION 06: PRIVACY',
    selectorPattern:
      /\.(?:product-frame(?:__[\w-]+)?|fundus-panel(?:__[\w-]+)?|result-panel(?:__[\w-]+)?|result-breakdown|result-row(?:--[\w-]+)?|result-row__[\w-]+)\b/g,
  },
  {
    name: 'Section 06 privacy and FAQ',
    owner: landingPageStylesheet,
    startMarker: 'SECTION 06: PRIVACY',
    endMarker: 'CLOSING CTA BACKGROUND',
    selectorPattern: /\.optic-(?:privacy|faq)(?:__[\w-]+)?(?:--[\w-]+)?\b/g,
  },
]

async function findCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name)

      if (entry.isDirectory()) return findCssFiles(absolutePath)
      return entry.isFile() && entry.name.endsWith('.css') ? [absolutePath] : []
    }),
  )

  return files.flat()
}

function validateStructure(file, css) {
  const errors = []
  let depth = 0
  let quote = null
  let escaped = false
  let inComment = false

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    const next = css[index + 1]

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false
        index += 1
      }
      continue
    }

    if (!quote && char === '/' && next === '*') {
      inComment = true
      index += 1
      continue
    }

    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') depth -= 1

    if (depth < 0) {
      errors.push(`${file}: closing brace without a matching opening brace`)
      depth = 0
    }
  }

  if (inComment) errors.push(`${file}: unclosed CSS comment`)
  if (quote) errors.push(`${file}: unclosed quoted value`)
  if (depth !== 0) errors.push(`${file}: unbalanced braces (${depth})`)
  const disallowedImportant = css.replace(
    /(?:animation-duration|animation-iteration-count|transition-duration|scroll-behavior)\s*:[^;{}]*!important\b/gi,
    '',
  )
  if (/!important\b/i.test(disallowedImportant)) {
    errors.push(`${file}: !important is forbidden outside reduced-motion accessibility overrides`)
  }

  return errors
}

function validateOwnership(file, css) {
  const errors = []

  for (const rule of stylesheetOwnership) {
    if (file !== rule.owner && rule.selectorPattern.test(css)) {
      errors.push(`${file}: ${rule.name} must only live in ${rule.owner}`)
    }
    rule.selectorPattern.lastIndex = 0
  }

  for (const rule of sectionOwnership) {
    const matches = [...css.matchAll(rule.selectorPattern)]
    if (matches.length === 0) continue

    if (file !== rule.owner) {
      errors.push(`${file}: ${rule.name} styles must only live in ${rule.owner}`)
      continue
    }

    const start = css.indexOf(rule.startMarker)
    const end = css.indexOf(rule.endMarker, start + rule.startMarker.length)

    if (start === -1 || end === -1) {
      errors.push(`${file}: missing ownership markers for ${rule.name}`)
      continue
    }

    for (const match of matches) {
      if (match.index < start || match.index >= end) {
        errors.push(`${file}: ${match[0]} is outside the canonical ${rule.name} block`)
      }
    }
  }

  return errors
}

const cssFiles = await findCssFiles(sourceRoot)
const errors = []

for (const file of cssFiles) {
  const css = await readFile(file, 'utf8')
  errors.push(...validateStructure(file, css), ...validateOwnership(file, css))
}

if (errors.length > 0) {
  console.error('CSS guard failed:\n')
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}

console.log(`CSS guard passed for ${cssFiles.length} stylesheet(s).`)
