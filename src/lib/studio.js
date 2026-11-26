import { platformFromUrl, platformById, normalizeUrl } from './platforms.js'

export const slugify = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Copies remain unsaved until reviewed and published. Never reuse the original URL.
export const makeReleaseCopy = (source, releases) => {
  const base = `${slugify(source.id || `${source.artist} ${source.title}`) || 'release'}-copy`
  const taken = new Set(releases.map((release) => release.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return { ...source, id, title: `${source.title || 'Untitled release'} (copy)`, isrc: '', release_date: '' }
}

// Keep filled fields by default; duplicates in a paste are resolved in paste order.
export const planLinkImport = (text, links, replaceExisting = false) => {
  const values = {}
  const unknown = []
  let skipped = 0
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const url = normalizeUrl(token)
    const platform = platformById(platformFromUrl(url))
    if (!platform) { unknown.push(token); continue }
    if (links[platform.column]?.trim() && !replaceExisting) { skipped++; continue }
    values[platform.column] = url
  }
  return { values, unknown, skipped }
}

export const linkPatch = (links, values) => Object.entries(values)
  .filter(([column, value]) => (links[column] || '') !== value)
  .map(([column, after]) => ({ column, before: links[column] || '', after }))

// Undo only untouched fields, so later manual edits are never overwritten.
export const undoLinkPatch = (links, patch) => Object.fromEntries(patch
  .filter(({ column, after }) => (links[column] || '') === after)
  .map(({ column, before }) => [column, before]))
