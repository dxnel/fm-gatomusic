// Single source of truth for every streaming platform: DB column, label, brand colours,
// icon, URL detection and "search on this platform" helper.
// Adding a platform = add one entry here (+ one column in the `links` table).

const SPOTIFY = 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m4.58 14.45c-.18.28-.55.36-.83.18-2.28-1.39-5.15-1.7-8.53-.93-.32.07-.64-.13-.71-.45-.07-.32.13-.64.45-.71 3.65-.84 6.83-.49 9.42 1.09.28.18.36.55.18.82m1.22-2.72c-.23.36-.71.47-1.07.24-2.61-1.6-6.6-2.07-9.69-1.13-.41.12-.84-.11-.96-.52-.12-.41.11-.84.52-.96 3.51-1.07 7.91-.55 10.98 1.34.36.23.47.71.24 1.03m.1-2.83C15.1 8.91 9.9 8.73 6.9 9.64c-.5.15-1.03-.13-1.18-.63-.15-.5.13-1.03.63-1.18 3.44-1.05 9.17-.84 12.78 1.29.45.27.6.86.33 1.31-.27.45-.86.6-1.31.33Z'
const APPLE = 'M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.82 5.09c.56-.68.94-1.63.84-2.58-.83.04-1.84.55-2.43 1.23-.52.59-.98 1.55-.86 2.48 1.96.15 1.76-.39 2.45-1.13Z'
const AMAZON = 'M12.06 17.65c-3.79 0-6.93-1.3-9.5-3.87.27-.3.72-.37 1.09-.13C6.35 15.5 8.99 16.3 12 16.3c3.2 0 6.06-.94 8.7-2.82.35-.25.82-.17 1.07.21.36.54-.3 1.34-1.14 1.83-2.5 1.46-5.4 2.13-8.57 2.13zm9.64-2.61c.21.34.11.83-.22 1.05-.28.18-5.32 3.19-11.4 3.19-4.22 0-7.85-1.3-10.05-2.88-.28-.2-.36-.6-.18-.89.18-.28.57-.35.84-.16 2.16 1.55 5.56 2.76 9.4 2.76 5.63 0 10.42-2.73 10.63-2.85.34-.2.78-.1 1.0.25z'
const DEEZER = 'M1 11h3v10H1V11m5-4h3v14H6V7m5-4h3v18h-3V3m5 8h3v10h-3V11m5-4h3v14h-3V7Z'
const SOUNDCLOUD = 'M11.17 11.45V17c-1.35 0-2.44-.92-2.44-2.06v-1.13c0-1.14 1.1-2.06 2.44-2.06zm-4.32.22c.98 0 1.77.67 1.77 1.5v1.65c0 .82-.8 1.5-1.77 1.5s-1.77-.68-1.77-1.5v-1.65c0-.83.8-1.5 1.77-1.5zm-3.53 1.03c.6 0 1.08.41 1.08.92v1.07c0 .51-.48.92-1.08.92s-1.08-.41-1.08-.92v-1.07c0-.51.48-.92 1.08-.92zm17.9 1.1c.01 1.9-1.79 3.44-4 3.44H11.7v-6.84c1.86-.34 3.51-1.68 4.2-3.41.97.02 1.91.43 2.58 1.13.78.82 1.16 1.97 1.04 3.14.77-.1 1.58.19 2.14.78.6.61.85 1.48.69 2.37z'
const YOUTUBE = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z'
const BANDCAMP = 'M22 6l-6.5 12h-13L9 6h13z'
const TIKTOK = 'M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v3.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93v4.61c-.01 3.2-2.18 6.13-5.32 6.84-3.14.71-6.55-.42-8.5-2.88-1.94-2.45-2.12-6.14-.4-8.81 1.72-2.67 5.09-3.92 8.16-3.04v3.13c-1.3-.12-2.67.14-3.66.97-.99.82-1.48 2.14-1.29 3.44.2 1.3 1.17 2.42 2.42 2.86 1.25.44 2.68.21 3.73-.59 1.05-.79 1.66-2.07 1.65-3.38V0h-1.18z'
const INSTAGRAM = 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2ZM7.5 4A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4ZM12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM17.5 5.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z'
const NOTE = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
// Simple stand-ins (not the official logos): ring + play, four diamonds.
const YT_MUSIC = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM10 8.5v7l6-3.5Z'
const TIDAL = 'M6.8 6.8 9.4 9.4 6.8 12 4.2 9.4ZM12 6.8 14.6 9.4 12 12 9.4 9.4ZM17.2 6.8 19.8 9.4 17.2 12 14.6 9.4ZM12 12 14.6 14.6 12 17.2 9.4 14.6Z'

/**
 * id        stable key (also used in click analytics)
 * column    column in the `links` table
 * label     name shown in admin and on buttons
 * cta       optional button text on the public page
 * brand/fg  hover fill + text colour on the public page
 * mono      true = icon uses text colour (brand colour would be invisible on dark/light)
 * icon      { path } or { letter }
 * search    URL builder to look the track up manually
 */
export const PLATFORMS = [
  { id: 'spotify', column: 'spotify_url', label: 'Spotify', cta: 'Play on Spotify', brand: '#1DB954', fg: '#06130b', icon: { path: SPOTIFY }, search: (q) => `https://open.spotify.com/search/${q}` },
  { id: 'apple', column: 'apple_url', label: 'Apple Music', brand: '#FA243C', fg: '#ffffff', icon: { path: APPLE }, search: (q) => `https://music.apple.com/search?term=${q}` },
  { id: 'youtube_music', column: 'youtube_music_url', label: 'YouTube Music', brand: '#FF0033', fg: '#ffffff', icon: { path: YT_MUSIC }, search: (q) => `https://music.youtube.com/search?q=${q}` },
  { id: 'amazon', column: 'amazon_url', label: 'Amazon Music', brand: '#0A9BD1', fg: '#ffffff', icon: { path: AMAZON }, search: (q) => `https://music.amazon.com/search/${q}` },
  { id: 'tidal', column: 'tidal_url', label: 'Tidal', brand: '#000000', fg: '#ffffff', mono: true, icon: { path: TIDAL }, search: (q) => `https://listen.tidal.com/search?q=${q}` },
  { id: 'deezer', column: 'deezer_url', label: 'Deezer', brand: '#A238FF', fg: '#ffffff', icon: { path: DEEZER }, search: (q) => `https://www.deezer.com/search/${q}` },
  { id: 'youtube', column: 'youtube_url', label: 'YouTube', brand: '#FF0000', fg: '#ffffff', icon: { path: YOUTUBE }, search: (q) => `https://www.youtube.com/results?search_query=${q}` },
  { id: 'soundcloud', column: 'soundcloud_url', label: 'SoundCloud', brand: '#FF5500', fg: '#ffffff', icon: { path: SOUNDCLOUD }, search: (q) => `https://soundcloud.com/search?q=${q}` },
  { id: 'bandcamp', column: 'bandcamp_url', label: 'Bandcamp', brand: '#1DA0C3', fg: '#ffffff', icon: { path: BANDCAMP }, search: (q) => `https://bandcamp.com/search?q=${q}` },
  { id: 'qobuz', column: 'qobuz_url', label: 'Qobuz', brand: '#0070EF', fg: '#ffffff', icon: { letter: 'Q' }, search: (q) => `https://www.qobuz.com/us-en/search?q=${q}` },
  { id: 'beatport', column: 'beatport_url', label: 'Beatport', brand: '#01FF95', fg: '#07130d', icon: { letter: 'B' }, search: (q) => `https://www.beatport.com/search?q=${q}` },
  { id: 'audiomack', column: 'audiomack_url', label: 'Audiomack', brand: '#FFA200', fg: '#1a1100', icon: { letter: 'A' }, search: (q) => `https://audiomack.com/search?q=${q}` },
  { id: 'pandora', column: 'pandora_url', label: 'Pandora', brand: '#3668FF', fg: '#ffffff', icon: { letter: 'P' }, search: (q) => `https://www.pandora.com/search/${q}/all` },
  { id: 'tiktok', column: 'tiktok_url', label: 'TikTok', brand: '#000000', fg: '#ffffff', mono: true, icon: { path: TIKTOK }, search: (q) => `https://www.tiktok.com/search?q=${q}` }
]

// Pre-save / pre-order buttons shown BEFORE release day. They only open the external link you paste
// in the admin (ffm.to, feature.fm, iTunes pre-order, ...). No login, no API, no limits.
export const PRESAVE = [
  { id: 'spotify', column: 'spotify_presave_url', label: 'Spotify', cta: 'Pre-Save on Spotify', brand: '#1DB954', fg: '#06130b', icon: { path: SPOTIFY } },
  { id: 'apple', column: 'apple_presave_url', label: 'Apple Music', cta: 'Pre-Add on Apple Music', brand: '#FA243C', fg: '#ffffff', icon: { path: APPLE } },
  { id: 'itunes', column: 'itunes_preorder_url', label: 'iTunes', cta: 'Pre-Order on iTunes', brand: '#EA4CC0', fg: '#ffffff', icon: { path: NOTE } }
]

// Profile buttons shown at the bottom of the page.
export const SOCIALS = [
  { id: 'instagram', column: 'social_instagram_url', label: '', brand: '#E1306C', fg: '#ffffff', icon: { path: INSTAGRAM } },
  { id: 'tiktok', column: 'social_tiktok_url', label: '', brand: '#000000', fg: '#ffffff', mono: true, icon: { path: TIKTOK } }
]

export const ARTIST_COLUMN = 'artist_url'

/** Every column of the `links` table the app reads/writes. */
export const LINK_COLUMNS = [
  ...PLATFORMS.map((p) => p.column),
  ...PRESAVE.map((p) => p.column),
  ...SOCIALS.map((p) => p.column),
  ARTIST_COLUMN
]

const BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]))
export const platformById = (id) => BY_ID[id]

export const searchUrl = (id, query) => BY_ID[id]?.search(encodeURIComponent(query.trim())) || '#'

/** Clean what a human pastes: trims, converts spotify: URIs, adds https://. */
export const normalizeUrl = (raw) => {
  let s = (raw || '').trim()
  if (!s) return ''
  const m = s.match(/^spotify:(track|album|artist):([A-Za-z0-9]+)$/)
  if (m) return `https://open.spotify.com/${m[1]}/${m[2]}`
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  return s
}

const HOSTS = [
  ['youtube_music', /^music\.youtube\.com$/],
  ['youtube', /(^|\.)youtube\.com$|^youtu\.be$/],
  ['spotify', /(^|\.)spotify\.com$|^spotify\.link$/],
  ['apple', /^(music|itunes|geo\.music)\.apple\.com$/],
  ['tidal', /(^|\.)tidal\.com$/],
  ['deezer', /(^|\.)deezer\.com$|^dzr\.page\.link$|(^|\.)deezer\.page\.link$/],
  ['amazon', /(^|\.)amazon\.[a-z.]+$|^amzn\.(to|eu)$/],
  ['soundcloud', /(^|\.)soundcloud\.com$/],
  ['bandcamp', /(^|\.)bandcamp\.com$/],
  ['qobuz', /(^|\.)qobuz\.com$/],
  ['beatport', /(^|\.)beatport\.com$/],
  ['audiomack', /(^|\.)audiomack\.com$/],
  ['pandora', /(^|\.)pandora\.com$/],
  ['tiktok', /(^|\.)tiktok\.com$/]
]

/** Which platform a URL belongs to (id) or null. */
export const platformFromUrl = (raw) => {
  let u
  try { u = new URL(normalizeUrl(raw)) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  return HOSTS.find(([, re]) => re.test(host))?.[0] || null
}

/* ---------------- Follow button (built from the artist link) ---------------- */
const FOLLOW_LABEL = {
  spotify: 'Follow on Spotify',
  apple: 'Follow on Apple Music',
  youtube_music: 'Follow on YouTube Music',
  youtube: 'Subscribe on YouTube',
  tidal: 'Follow on Tidal',
  deezer: 'Follow on Deezer',
  soundcloud: 'Follow on SoundCloud',
  bandcamp: 'Follow on Bandcamp',
  amazon: 'Follow on Amazon Music',
  audiomack: 'Follow on Audiomack',
  qobuz: 'Follow on Qobuz',
  beatport: 'Follow on Beatport',
  pandora: 'Follow on Pandora',
  tiktok: 'Follow on TikTok'
}

// Platforms whose artist pages contain /artist/ (to warn if a track/album link was pasted by mistake)
const ARTIST_PATH = new Set(['spotify', 'apple', 'deezer', 'tidal'])

/**
 * Artist link -> { id, url, label, icon, mono, looksWrong }  (null if no link).
 * The label/icon follow the platform of the link, so the button updates when you change it in the admin.
 */
export const followInfo = (raw) => {
  const url = normalizeUrl(raw)
  if (!url) return null
  let u
  try { u = new URL(url) } catch { return null }
  const id = platformFromUrl(url)
  if (id && FOLLOW_LABEL[id]) {
    return {
      id, url, label: FOLLOW_LABEL[id], icon: BY_ID[id].icon, mono: !!BY_ID[id].mono,
      looksWrong: ARTIST_PATH.has(id) && !u.pathname.includes('/artist/')
    }
  }
  if (/(^|\.)instagram\.com$/.test(u.hostname.replace(/^www\./, ''))) {
    return { id: 'instagram', url, label: 'Follow on Instagram', icon: SOCIALS[0].icon, mono: false, looksWrong: false }
  }
  return { id: 'link', url, label: 'Follow the artist', icon: null, mono: false, looksWrong: false }
}