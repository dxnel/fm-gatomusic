// Releases go live at 00:00 Swiss time (Europe/Zurich) on their release day.
// The admin only stores a calendar date (YYYY-MM-DD). Everything else is derived here.
//
// Works whether the `release_date` column is `date` or `timestamptz`:
//  - plain 'YYYY-MM-DD'      -> used as is
//  - any other timestamp     -> converted to its calendar day in Zurich
// (A 'YYYY-MM-DD' written into a timestamptz column becomes 00:00 UTC, which is always
//  01:00 / 02:00 on the same day in Zurich, so the calendar day never shifts.)

export const SWISS_TZ = 'Europe/Zurich'
const pad = (n) => String(n).padStart(2, '0')

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SWISS_TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
})

const zurichParts = (ms) =>
  Object.fromEntries(
    partsFmt.formatToParts(ms).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)])
  )

const toZurichYMD = (ms) => {
  const p = zurichParts(ms)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

// Offset (ms) of Zurich from UTC at a given instant (DST aware).
const offsetMs = (utcMs) => {
  const p = zurichParts(utcMs)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000
}

/** Any stored value -> 'YYYY-MM-DD' ('' if empty / invalid). */
export const toYMD = (value) => {
  if (!value) return ''
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const ms = new Date(s).getTime()
  return Number.isNaN(ms) ? '' : toZurichYMD(ms)
}

/** 'YYYY-MM-DD' -> epoch ms of 00:00 in Zurich on that day. */
export const zurichMidnight = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - offsetMs(guess)
  t = guess - offsetMs(t) // second pass settles DST edge cases
  return t
}

/** Stored value -> epoch ms the release goes live (null = no date = live now). */
export const releaseTime = (value) => {
  const ymd = toYMD(value)
  return ymd ? zurichMidnight(ymd) : null
}

export const isLive = (value, now = Date.now()) => {
  const t = releaseTime(value)
  return t === null || now >= t
}

/** "in 5h" / "in 3d" for upcoming releases, '' otherwise. */
export const relativeTo = (value, now = Date.now()) => {
  const t = releaseTime(value)
  if (t === null || t <= now) return ''
  const h = Math.floor((t - now) / 3600000)
  if (h < 1) return 'in <1h'
  if (h < 48) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

const fmtDay = (ymd, opts) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
}

/** 'OCTOBER 9, 2026' style (public page badge). */
export const formatLong = (value) => {
  const ymd = toYMD(value)
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase()
}

/** 'Fri, 9 Oct 2026' (admin). */
export const formatShort = (value) => {
  const ymd = toYMD(value)
  return ymd ? fmtDay(ymd, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'
}
