// "Smart fill": find metadata + streaming links from an ISRC, a Deezer / Apple Music link,
// or plain "Artist - Title" text, using free APIs only.
//
//  Deezer       (via your existing /api/deezer proxy)  title, artist, cover, ISRC, link   -> exact
//  Spotify      (your `spotify-search` edge function)   Spotify link by ISRC               -> exact
//  iTunes       (public Search API, no key)             Apple Music link by artist+title    -> exact if duration matches, else fuzzy
//  MusicBrainz  (public API, no key, 1 req/s)           any streaming links stored for the ISRC -> best effort
//
// NOTE: song.link / Odesli was removed: its public API was retired (July 2026).

import { supabase } from '../supabase'
import { platformFromUrl } from './platforms'

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/
export const cleanIsrc = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase()

export function detectInput(raw) {
  const s = (raw || '').trim()
  if (!s) return null
  const isrc = cleanIsrc(s)
  if (ISRC_RE.test(isrc)) return { kind: 'isrc', isrc }

  if (/^https?:\/\//i.test(s)) {
    let u
    try { u = new URL(s) } catch { return null }
    const host = u.hostname.replace(/^www\./, '')
    if (/(^|\.)deezer\.com$/.test(host)) {
      const m = u.pathname.match(/track\/(\d+)/)
      if (m) return { kind: 'deezer', id: m[1] }
    }
    if (/^(music|itunes)\.apple\.com$/.test(host)) {
      const id = u.searchParams.get('i') || u.pathname.match(/\/song\/[^/]+\/(\d+)/)?.[1]
      if (id) return { kind: 'apple', id, url: s }
    }
    return { kind: 'unsupported', host }
  }
  return { kind: 'text', q: s }
}

/* ------------------------------ helpers ------------------------------ */
const getJSON = async (url, timeout = 9000) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

const norm = (s = '') =>
  s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const similar = (a, b) => {
  const x = norm(a), y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

/* ------------------------------- Deezer ------------------------------ */
const deezerTrack = async (idOrIsrc) => {
  const d = await getJSON(`/api/deezer/track/${idOrIsrc}`)
  return d && !d.error && d.id ? d : null
}

const deezerSearch = async (artist, title) => {
  const q = artist && title ? `artist:"${artist}" track:"${title}"` : title || artist
  const d = await getJSON(`/api/deezer/search?q=${encodeURIComponent(q)}&limit=6`)
  const list = d?.data || []
  const hit = list.find((t) => !title || similar(t.title, title)) || list[0]
  return hit ? deezerTrack(hit.id) : null
}

/* ------------------------------- iTunes ------------------------------ */
const cleanAppleUrl = (raw) => {
  try {
    const u = new URL(raw)
    const i = u.searchParams.get('i')
    u.search = i ? `?i=${i}` : ''
    u.hash = ''
    return u.toString()
  } catch { return raw }
}

const itunesLookup = async (id) => {
  const d = await getJSON(`https://itunes.apple.com/lookup?id=${id}&entity=song`)
  return d?.results?.[0] || null
}

const itunesMatch = async (artist, title, durationSec) => {
  const term = encodeURIComponent(`${artist} ${title}`)
  const d = await getJSON(`https://itunes.apple.com/search?term=${term}&entity=song&media=music&limit=10`)
  const cands = (d?.results || [])
    .filter((r) => similar(r.trackName, title) && (similar(r.artistName, artist) || similar(artist, r.artistName)))
    .map((r) => ({ r, durOk: durationSec ? Math.abs((r.trackTimeMillis || 0) / 1000 - durationSec) <= 3 : false }))
    .sort((a, b) => Number(b.durOk) - Number(a.durOk))
  const best = cands[0]
  if (!best) return null
  return {
    url: cleanAppleUrl(best.r.trackViewUrl),
    confidence: best.durOk ? 'exact' : 'fuzzy',
    track: best.r
  }
}

/* ----------------------------- MusicBrainz --------------------------- */
const musicbrainzUrls = async (isrc) => {
  const a = await getJSON(`https://musicbrainz.org/ws/2/isrc/${isrc}?fmt=json`)
  const id = a?.recordings?.[0]?.id
  if (!id) return []
  const b = await getJSON(`https://musicbrainz.org/ws/2/recording/${id}?inc=url-rels&fmt=json`)
  return (b?.relations || []).map((r) => r.url?.resource).filter(Boolean)
}

/* ------------------------------- Spotify ----------------------------- */
const spotifyByIsrc = async (isrc) => {
  const { data, error } = await supabase.functions.invoke('spotify-search', { body: { isrc } })
  return !error && data?.spotify_url ? data : null
}

/* -------------------------------- main ------------------------------- */
/**
 * @returns {{ meta: {title?, artist?, cover_url?, isrc?, release_date?},
 *             found: Record<platformId, {url, source, confidence}>,
 *             sources: Record<string, boolean> }}
 */
export async function runScan(input, { onStep = () => {} } = {}) {
  const found = {}
  const put = (id, url, source, confidence = 'exact') => {
    if (id && url && !found[id]) found[id] = { url, source, confidence }
  }
  const sources = { deezer: false, spotify: false, itunes: false, musicbrainz: false }
  let dz = null
  let apple = null // iTunes track when we start from an Apple Music link

  // 1. Resolve to a Deezer track (gives us a clean ISRC + cover)
  onStep('Looking up Deezer…')
  try {
    if (input.kind === 'isrc') dz = await deezerTrack(`isrc:${input.isrc}`)
    else if (input.kind === 'deezer') dz = await deezerTrack(input.id)
    else if (input.kind === 'apple') {
      apple = await itunesLookup(input.id)
      if (apple) {
        put('apple', cleanAppleUrl(input.url), 'Your link', 'exact')
        dz = await deezerSearch(apple.artistName, apple.trackName)
      }
    } else if (input.kind === 'text') {
      const parts = input.q.split(/\s[-–—]\s/)
      dz = parts.length === 2 ? await deezerSearch(parts[0].trim(), parts[1].trim()) : await deezerSearch('', input.q)
    }
  } catch (e) { console.warn('Deezer scan failed', e) }

  const isrc = dz?.isrc || input.isrc || ''
  const artist = dz?.artist?.name || apple?.artistName || ''
  const title = dz?.title || apple?.trackName || ''

  if (dz) {
    sources.deezer = true
    put('deezer', dz.link, 'Deezer')
  }

  // 2. Everything else in parallel
  onStep('Searching Spotify, Apple Music, MusicBrainz…')
  const [sp, it, mb] = await Promise.allSettled([
    isrc ? spotifyByIsrc(isrc) : null,
    artist && title ? itunesMatch(artist, title, dz?.duration) : null,
    isrc ? musicbrainzUrls(isrc) : null
  ])

  if (sp.status === 'fulfilled' && sp.value) {
    sources.spotify = true
    put('spotify', sp.value.spotify_url, 'Spotify (ISRC)')
  }
  if (it.status === 'fulfilled' && it.value) {
    sources.itunes = true
    put('apple', it.value.url, 'iTunes search', it.value.confidence)
  }
  if (mb.status === 'fulfilled' && mb.value?.length) {
    sources.musicbrainz = true
    for (const url of mb.value) put(platformFromUrl(url), url, 'MusicBrainz', 'fuzzy')
  }

  const meta = {
    isrc,
    title: title || undefined,
    artist: artist || undefined,
    cover_url: dz?.album?.cover_xl || apple?.artworkUrl100?.replace('100x100bb', '1000x1000bb') || undefined,
    release_date: dz?.release_date || undefined
  }
  return { meta, found, sources }
}