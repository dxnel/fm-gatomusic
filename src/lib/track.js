// Minimal first-party analytics: one "view" per session, one row per platform click.
// Fails silently (e.g. if the release_events table doesn't exist yet) and never
// counts you while you're logged in to the admin.
import { supabase } from '../supabase'

let isAdmin = null
const adminSession = async () => {
  if (isAdmin === null) {
    try {
      const { data } = await supabase.auth.getSession()
      isAdmin = !!data.session
    } catch { isAdmin = false }
  }
  return isAdmin
}

const send = async (row) => {
  try {
    if (await adminSession()) return
    await supabase.from('release_events').insert(row)
  } catch { /* analytics must never break the page */ }
}

export const trackView = (releaseId) => {
  try {
    const key = `gato:view:${releaseId}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* private mode */ }
  return send({ release_id: releaseId, type: 'view' })
}

export const trackClick = (releaseId, platform) => send({ release_id: releaseId, type: 'click', platform })
