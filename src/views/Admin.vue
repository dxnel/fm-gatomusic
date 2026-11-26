<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { supabase } from '../supabase'
import { PLATFORMS, PRESAVE, SOCIALS, LINK_COLUMNS, platformById, normalizeUrl } from '../lib/platforms'
import { toYMD, zurichMidnight, isLive, relativeTo, formatShort } from '../lib/releaseDate'
import { detectInput, runScan, cleanIsrc } from '../lib/scan'
import { loadPalette } from '../lib/palette'
import { useSystemChrome } from '../composables/useSystemChrome'
import logoUrl from '../assets/gato_logo.png'
import StudioLinks from '../components/StudioLinks.vue'
import StudioActions from '../components/StudioActions.vue'
import { Sun, Moon, LogOut, Plus, X, Search, Upload, Check, LoaderCircle, Trash2 } from '@lucide/vue'
import '../studio.css'
import { slugify, makeReleaseCopy } from '../lib/studio'

/* ============================== theme ============================== */
const adminTheme = ref('dark')
try { adminTheme.value = localStorage.getItem('gato-admin-theme') || 'dark' } catch { /* private mode */ }
const adminBg = computed(() => (adminTheme.value === 'light' ? '#f1efea' : '#0e0e10'))
const chrome = useSystemChrome()
watch(adminBg, (c) => chrome.set(c), { immediate: true })
const toggleTheme = () => {
  adminTheme.value = adminTheme.value === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem('gato-admin-theme', adminTheme.value) } catch { /* ignore */ }
}

/* ============================== toast / confirm ============================== */
const toast = ref({ show: false, message: '', type: 'info' })
let toastTimer
const showToast = (message, type = 'info') => {
  toast.value = { show: true, message, type }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value.show = false), 3500)
}

const confirmState = ref(null)
const askConfirm = (opts) => new Promise((resolve) => { confirmState.value = { ...opts, resolve } })
const answerConfirm = (value) => { confirmState.value?.resolve(value); confirmState.value = null }

/* ============================== auth ============================== */
const user = ref(null)
const isLoading = ref(true)
const email = ref('')
const password = ref('')
const isLoggingIn = ref(false)

const handleLogin = async () => {
  if (!email.value || !password.value || isLoggingIn.value) return
  isLoggingIn.value = true
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  isLoggingIn.value = false
  if (error) return showToast(error.message, 'error')
  user.value = data.user
  password.value = ''
  await loadAll()
}

const handleLogout = async () => {
  await supabase.auth.signOut()
  user.value = null
  releases.value = []
}

/* ============================== data ============================== */
const releases = ref([])
const stats = ref({})

const flatten = (r) => {
  const l = Array.isArray(r.links) ? r.links[0] : r.links
  const out = { ...r, release_date: toYMD(r.release_date) }
  delete out.links
  for (const c of LINK_COLUMNS) out[c] = l?.[c] || ''
  return out
}

const fetchReleases = async () => {
  const { data, error } = await supabase.from('releases').select('*, links(*)').order('release_date', { ascending: false })
  if (error) return showToast('Could not load releases.', 'error')
  releases.value = (data || []).map(flatten)
}

const fetchStats = async () => {
  const { data, error } = await supabase.from('release_stats').select('*')
  if (error || !data) return
  stats.value = Object.fromEntries(data.map((s) => [s.release_id, { views: Number(s.views), clicks: Number(s.clicks) }]))
}

const loadAll = () => Promise.all([fetchReleases(), fetchStats()])

/* ---- live clock: statuses flip at Swiss midnight without a reload ---- */
const now = ref(Date.now())
let clock

const statusOf = (r) => (isLive(r.release_date, now.value) ? 'live' : 'upcoming')
const badgeText = (r) => (statusOf(r) === 'live' ? 'Live' : `Upcoming · ${relativeTo(r.release_date, now.value)}`)

const counts = computed(() => ({
  all: releases.value.length,
  upcoming: releases.value.filter((r) => statusOf(r) === 'upcoming').length,
  live: releases.value.filter((r) => statusOf(r) === 'live').length
}))

const nextRelease = computed(() =>
  releases.value.filter((r) => statusOf(r) === 'upcoming').sort((a, b) => a.release_date.localeCompare(b.release_date))[0]
)

/* ---- search + filter ---- */
const search = ref('')
const filter = ref('all')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return releases.value
    .filter((r) => filter.value === 'all' || statusOf(r) === filter.value)
    .filter((r) => !q || `${r.title} ${r.artist} ${r.id}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const sa = statusOf(a), sb = statusOf(b)
      if (sa !== sb) return sa === 'upcoming' ? -1 : 1
      if (sa === 'upcoming') return a.release_date.localeCompare(b.release_date)
      return (b.release_date || '').localeCompare(a.release_date || '')
    })
})

/* ============================== editor ============================== */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED = new Set(['admin', 'callback', 'api', 'assets', 'src'])

const emptyRelease = () => ({
  id: '', isrc: '', title: '', artist: '', cover_url: '', release_date: '',
  use_blur: true, theme: 'dark', show_tracklist: false, tracklist: '',
  ...Object.fromEntries(LINK_COLUMNS.map((c) => [c, '']))
})

const showEditor = ref(false)
const editorSession = ref(0)
const deletingId = ref(null)
const editorTab = ref('release')
const editorTabs = [
  { id: 'release', label: 'Release' },
  { id: 'links', label: 'Links' },
  { id: 'appearance', label: 'Appearance' }
]
const drawerBody = ref(null)
const editorDialog = ref(null)
const confirmDialog = ref(null)
let returnFocus
let confirmReturnFocus
watch(editorTab, () => { drawerBody.value?.scrollTo({ top: 0 }) })
watch([showEditor, confirmState], async ([open, confirmation], [wasOpen, hadConfirmation]) => {
  if (open && !wasOpen) returnFocus = document.activeElement
  if (confirmation && !hadConfirmation) confirmReturnFocus = document.activeElement
  if (!confirmation && hadConfirmation) {
    await nextTick()
    if (confirmReturnFocus?.isConnected) confirmReturnFocus.focus({ preventScroll: true })
    return
  }
  await nextTick()
  const dialog = confirmation ? confirmDialog.value : open ? editorDialog.value : null
  if (dialog) dialog.querySelector('button, input:not([disabled])')?.focus({ preventScroll: true })
  else if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  else document.querySelector('.new-btn')?.focus({ preventScroll: true })
}, { flush: 'post' })
const isEditing = ref(false)
const isSaving = ref(false)
const current = ref(emptyRelease())
const snapshot = ref(null)
const slugTouched = ref(false)
const isDirty = computed(() => showEditor.value && (!snapshot.value || Object.keys(snapshot.value).some((key) => current.value[key] !== snapshot.value[key])))

const scanInput = ref('')
const isScanning = ref(false)
const scanStep = ref('')
const scanReport = ref(null)
const overwrite = ref(false)
const reviewSet = ref(new Set())
const palette = ref(null)
const paletteError = ref('')
const platformClicks = ref([])
const selectedFileName = ref('')
const isUploading = ref(false)
const dragging = ref(false)
const editorBusy = computed(() => isSaving.value || isUploading.value || isScanning.value || !!deletingId.value)
const filledLinkCount = computed(() => LINK_COLUMNS.filter((column) => current.value[column]?.trim()).length)
const trackCount = computed(() => (current.value.tracklist || '').split('\n').filter((line) => line.trim()).length)

const resetEditorState = () => {
  scanReport.value = null
  reviewSet.value = new Set()
  palette.value = null
  paletteError.value = ''
  platformClicks.value = []
  selectedFileName.value = ''
  overwrite.value = false
}

const openEditor = (release = null, tab = 'release') => {
  if (deletingId.value) return
  const defaults = emptyRelease()
  const base = { ...defaults }
  if (release) for (const k of Object.keys(defaults)) if (release[k] !== null && release[k] !== undefined) base[k] = release[k]
  current.value = base
  isEditing.value = !!release
  slugTouched.value = !!release
  snapshot.value = { ...base }
  scanInput.value = base.isrc || ''
  resetEditorState()
  editorSession.value++
  editorTab.value = tab
  showEditor.value = true
  if (release) loadPlatformClicks(release.id)
}

const duplicateRelease = (source = current.value) => {
  if (editorBusy.value) return
  const copy = makeReleaseCopy(source, releases.value)
  openEditor()
  const base = emptyRelease()
  for (const key of Object.keys(base)) if (copy[key] != null) base[key] = copy[key]
  current.value = base
  slugTouched.value = true
  snapshot.value = null
  showToast('Copy created. Review its links and release date before publishing.', 'info')
  nextTick(() => editorDialog.value?.querySelector('#release-title')?.focus())
}

const closeEditor = async (force = false) => {
  if (editorBusy.value) return
  if (!force && isDirty.value) {
    const discard = await askConfirm({ title: 'Discard changes?', message: 'You have unsaved changes in this release.', confirmLabel: 'Discard', danger: true })
    if (!discard) return
  }
  showEditor.value = false
}

watch(() => [current.value.artist, current.value.title], () => {
  if (!isEditing.value && !slugTouched.value) current.value.id = slugify(`${current.value.artist} ${current.value.title}`)
})

watch([showEditor, confirmState], ([open, confirmation]) => { document.body.style.overflow = open || confirmation ? 'hidden' : '' })

const dateHint = computed(() => {
  const ymd = current.value.release_date
  if (!ymd) return 'No date: the page goes live immediately.'
  const t = zurichMidnight(ymd)
  const local = new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return now.value >= t
    ? `Live since 00:00 Swiss time (${local} your time).`
    : `Goes live at 00:00 Swiss time (${local} your time).`
})

const searchQuery = computed(() => `${current.value.artist} ${current.value.title}`.trim())
const updateLink = (column, value) => { current.value[column] = value }
const reviewLink = (column, restore = false) => {
  if (restore) reviewSet.value.add(column)
  else reviewSet.value.delete(column)
}

const scan = async () => {
  const input = detectInput(scanInput.value)
  if (editorBusy.value) return
  if (!input) return showToast('Enter an ISRC, a Deezer / Apple Music link, or "Artist - Title".', 'error')
  if (input.kind === 'unsupported') {
    return showToast(`Can't scan ${input.host} links. Paste them in the box below instead.`, 'error')
  }
  isScanning.value = true
  scanReport.value = null
  try {
    const res = await runScan(input, { onStep: (s) => (scanStep.value = s) })
    applyScan(res)
  } catch (e) {
    console.error(e)
    showToast('Scan failed.', 'error')
  }
  isScanning.value = false
  scanStep.value = ''
}

const applyScan = ({ meta, found, sources }) => {
  const c = current.value
  const allow = (v) => overwrite.value || !v

  if (meta.isrc && allow(c.isrc)) c.isrc = meta.isrc
  if (meta.title && allow(c.title)) c.title = meta.title
  if (meta.artist && allow(c.artist)) c.artist = meta.artist
  if (meta.release_date && allow(c.release_date)) c.release_date = toYMD(meta.release_date)
  if (meta.cover_url && allow(c.cover_url)) {
    c.cover_url = meta.cover_url
    rehostCover(meta.cover_url, true)
  }

  const items = []
  for (const [id, hit] of Object.entries(found)) {
    const p = platformById(id)
    if (!p) continue
    const applied = allow(c[p.column])
    if (applied) {
      c[p.column] = hit.url
      if (hit.confidence === 'fuzzy') reviewSet.value.add(p.column)
    }
    items.push({ id, label: p.label, source: hit.source, confidence: hit.confidence, applied })
  }
  const missing = PLATFORMS.filter((p) => !found[p.id] && !c[p.column]).map((p) => p.label)
  scanReport.value = { items, missing, sources }

  const n = items.filter((i) => i.applied).length
  if (n || meta.title) showToast(`Filled ${n} link${n === 1 ? '' : 's'}${items.some((i) => i.confidence === 'fuzzy' && i.applied) ? ' (check the ones marked "verify")' : ''}.`, 'success')
  else showToast('Nothing found for that input.', 'error')
}

const squareCover = async (file) => {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const out = Math.min(side, 1000)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = out
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
    const type = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const uploadCover = async (file) => {
  if (isUploading.value || isSaving.value) return false
  isUploading.value = true
  try {
    const blob = await squareCover(file)
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
    const name = `cover_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('covers').upload(name, blob, { contentType: blob.type, cacheControl: '31536000' })
    if (error) throw error
    current.value.cover_url = supabase.storage.from('covers').getPublicUrl(name).data.publicUrl
    showToast('Artwork uploaded.', 'success')
    return true
  } catch (e) {
    console.error(e)
    showToast(`Upload failed${e?.message ? `: ${e.message}` : ''}`, 'error')
    return false
  } finally {
    isUploading.value = false
  }
}

const handleImageUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  selectedFileName.value = file.name
  uploadCover(file)
  event.target.value = ''
}

const onDrop = (event) => {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return showToast('Drop an image file.', 'error')
  selectedFileName.value = file.name
  uploadCover(file)
}

const rehostCover = async (url, silent = false) => {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await uploadCover(await res.blob())
  } catch {
    if (!silent) showToast("This host doesn't allow downloading the image. Upload the file instead.", 'error')
  }
}

let paletteTimer
const paletteCache = new Map()
watch(() => [showEditor.value, current.value.cover_url, current.value.theme, editorTab.value], ([open, url, theme, tab], _, onCleanup) => {
  clearTimeout(paletteTimer)
  let active = true
  onCleanup(() => { active = false; clearTimeout(paletteTimer) })
  palette.value = null
  paletteError.value = ''
  if (!open || !url || tab !== 'appearance') return
  const key = `${theme}:${url}`
  if (paletteCache.has(key)) { palette.value = paletteCache.get(key); return }
  paletteTimer = setTimeout(async () => {
    try {
      const result = await loadPalette(url, theme !== 'light')
      if (!active) return
      if (paletteCache.size >= 20) paletteCache.delete(paletteCache.keys().next().value)
      paletteCache.set(key, result)
      palette.value = result
    } catch {
      if (active) paletteError.value = "This image host blocks colour previews. Upload the image instead."
    }
  }, 300)
})

const loadPlatformClicks = async (id) => {
  const { data } = await supabase.from('release_clicks_by_platform').select('platform, clicks').eq('release_id', id).order('clicks', { ascending: false })
  if (showEditor.value && isEditing.value && current.value.id === id) platformClicks.value = data || []
}

const clickLabel = (key) => {
  if (key.startsWith('presave-')) {
    const id = key.slice(8)
    return `${PRESAVE.find((p) => p.id === id)?.label || id} (pre-save)`
  }
  if (key.startsWith('social-')) {
    const id = key.slice(7)
    return `${SOCIALS.find((p) => p.id === id)?.label || id} (profile)`
  }
  if (key === 'follow') return 'Follow button'
  if (key === 'share') return 'Share button'
  return platformById(key)?.label || key
}

const revealField = (id, message) => {
  editorTab.value = 'release'
  showToast(message, 'error')
  nextTick(() => editorDialog.value?.querySelector(`#${id}`)?.focus())
}

const saveRelease = async () => {
  if (editorBusy.value || confirmState.value) return
  const c = current.value
  c.id = c.id.trim()
  if (!c.title.trim()) return revealField('release-title', 'Add a release title.')
  if (!c.artist.trim()) return revealField('release-artist', 'Add an artist name.')
  if (!SLUG_RE.test(c.id) || RESERVED.has(c.id)) return revealField('release-slug', 'Use a page URL with lowercase letters, numbers and dashes.')

  isSaving.value = true
  try {
    if (!isEditing.value) {
      const { data: exists } = await supabase.from('releases').select('id').eq('id', c.id).maybeSingle()
      if (exists) throw new Error('slug-taken')
    }

    const releaseRow = {
      id: c.id,
      isrc: cleanIsrc(c.isrc) || null,
      title: c.title.trim(),
      artist: c.artist.trim(),
      cover_url: c.cover_url?.trim() || null,
      release_date: c.release_date || null,
      use_blur: c.use_blur,
      theme: c.theme,
      show_tracklist: !!c.show_tracklist,
      tracklist: c.tracklist?.trim() || null
    }
    const { error: relError } = await supabase.from('releases').upsert(releaseRow)
    if (relError) throw relError

    const linksRow = { release_id: c.id }
    for (const col of LINK_COLUMNS) linksRow[col] = normalizeUrl(c[col]) || null
    const { error: linkError } = await supabase.from('links').upsert(linksRow, { onConflict: 'release_id' })
    if (linkError) throw linkError

    await loadAll()
    snapshot.value = { ...current.value }
    showEditor.value = false
    showToast('Saved.', 'success')
  } catch (err) {
    console.error(err)
    if (err.message === 'slug-taken') showToast('That slug is already used by another release.', 'error')
    else if (err.code === 'PGRST204' || /column/i.test(err.message || '')) showToast('Database is missing columns. Run supabase/migration.sql AND migration-2.sql first.', 'error')
    else showToast('Could not save.', 'error')
  }
  isSaving.value = false
}

const deleteRelease = async (release = current.value) => {
  if (editorBusy.value || confirmState.value) return
  const { id, title } = release
  const ok = await askConfirm({
    title: 'Delete release?',
    message: `“${title}” and its links will be permanently deleted.`,
    confirmLabel: 'Delete release',
    danger: true
  })
  if (!ok) return
  deletingId.value = id
  let removedLinks = null
  let linksRemoved = false
  try {
    // Keep a restore copy in case the second request fails.
    const backup = await supabase.from('links').select('*').eq('release_id', id).maybeSingle()
    if (backup.error) throw backup.error
    removedLinks = backup.data
    const linksResult = await supabase.from('links').delete().eq('release_id', id)
    if (linksResult.error) throw linksResult.error
    linksRemoved = true
    const result = await supabase.from('releases').delete().eq('id', id).select('id')
    if (result.error) throw result.error
    if (!result.data?.length) throw new Error('Release was not deleted. Check your access and try again.')
    if (showEditor.value && current.value.id === id) showEditor.value = false
    releases.value = releases.value.filter((item) => item.id !== id)
    delete stats.value[id]
    showToast('Release deleted.', 'success')
    await nextTick()
    document.querySelector('.rel, .new-btn')?.focus({ preventScroll: true })
  } catch (error) {
    if (linksRemoved && removedLinks) {
      const restored = await supabase.from('links').upsert(removedLinks, { onConflict: 'release_id' })
      if (restored.error) {
        showToast('Delete failed and links could not be restored. Reload and check this release.', 'error')
        return
      }
    }
    showToast('Could not delete. Your release was kept.', 'error')
  } finally {
    deletingId.value = null
  }
}

const pageUrl = (id) => `${window.location.origin}/${id}`
const copy = async (text, msg = 'Link copied.') => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      // Silent fallback for older browsers or non-HTTPS environments
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'absolute'
      textArea.style.left = '-999999px'
      document.body.prepend(textArea)
      textArea.select()
      document.execCommand('copy')
      textArea.remove()
    }
    showToast(msg, 'success')
  } catch {
    showToast('Failed to copy link.', 'error')
  }
}

const onKey = (e) => {
  const dialog = confirmState.value ? confirmDialog.value : showEditor.value ? editorDialog.value : null
  if (!dialog) return
  if (e.key === 'Tab') {
    const items = [...dialog.querySelectorAll('button, a[href], input, textarea, [tabindex="0"]')]
      .filter((el) => !el.disabled && el.getClientRects().length && el.tabIndex >= 0)
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus() }
  }
  if (confirmState.value) {
    if (e.key === 'Escape') { e.preventDefault(); answerConfirm(false) }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') e.preventDefault()
    return
  }
  if (e.key === 'Escape' && !confirmState.value) closeEditor()
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveRelease()
  }
}
const onBeforeUnload = (e) => {
  if (isDirty.value) { e.preventDefault(); e.returnValue = '' }
}

onMounted(async () => {
  document.title = 'Studio | fm GATO'
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', onBeforeUnload)
  clock = setInterval(() => (now.value = Date.now()), 30000)

  const { data } = await supabase.auth.getSession()
  user.value = data.session?.user || null
  if (user.value) await loadAll()
  isLoading.value = false
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', onBeforeUnload)
  clearInterval(clock)
  clearTimeout(paletteTimer)
  clearTimeout(toastTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin g-page" :class="`theme-${adminTheme}`" :style="{ '--page-bg': adminBg, '--accent': '#bdbdbd' }">

    <Transition name="toast">
      <div v-if="toast.show" :class="['g-toast', toast.type]" role="status">{{ toast.message }}</div>
    </Transition>

    <!-- loading -->
    <div v-if="isLoading" class="loading-state">
      <img :src="logoUrl" alt="GATO" class="logo-large pulse" />
    </div>

    <!-- login -->
    <main v-else-if="!user" class="login-wrap">
      <form class="login-card g-card" @submit.prevent="handleLogin">
        <img :src="logoUrl" alt="" class="logo-login" />
        <h1 class="fm-logo brand-huge"><span class="fm-prefix">fm</span>GATO</h1>
        <p class="subtitle">Studio</p>
        <input v-model="email" type="email" placeholder="Email" aria-label="Email" required class="g-input" autocomplete="username" />
        <input v-model="password" type="password" placeholder="Password" aria-label="Password" required class="g-input" autocomplete="current-password" />
        <button type="submit" class="g-btn g-btn--primary g-btn--block" :disabled="isLoggingIn">
          {{ isLoggingIn ? 'Connecting…' : 'Connect' }}
        </button>
      </form>
    </main>

    <!-- dashboard -->
    <main v-else class="wrap" :inert="showEditor || !!confirmState">
      <nav class="navbar">
        <div class="nav-brand">
          <img :src="logoUrl" alt="" class="logo-small" />
          <span class="fm-logo nav-title"><span class="fm-prefix">fm</span>GATO</span>
          <span class="nav-tag">Studio</span>
        </div>
        <div class="nav-actions">
          <button class="icon-btn nav-icon" @click="toggleTheme" :aria-label="adminTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'" :title="adminTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
            <Sun v-if="adminTheme === 'dark'" :size="19" aria-hidden="true" /><Moon v-else :size="19" aria-hidden="true" />
          </button>
          <button class="icon-btn nav-icon" aria-label="Log out" title="Log out" @click="handleLogout"><LogOut :size="19" aria-hidden="true" /></button>
        </div>
      </nav>

      <header class="library-head">
        <div>
          <h1 class="title-serif library-title">Releases</h1>
          <p class="library-summary">{{ counts.all }} releases<span v-if="nextRelease"> · Next: {{ nextRelease.title }} {{ relativeTo(nextRelease.release_date, now) }}</span></p>
        </div>
        <button class="g-btn g-btn--primary new-btn" @click="openEditor()"><Plus :size="18" aria-hidden="true" /><span>New release</span></button>
      </header>

      <div class="toolbar">
        <input v-model="search" class="g-input search" type="search" aria-label="Search releases" placeholder="Search releases…" />
        <div class="chips" role="group" aria-label="Filter releases">
          <button v-for="f in ['all', 'upcoming', 'live']" :key="f" class="chip" :class="{ active: filter === f }" :aria-pressed="filter === f" @click="filter = f">
            <span v-if="f !== 'all'" class="chip-dot" :class="f"></span> {{ f }}<span class="chip-n">{{ counts[f] }}</span>
          </button>
        </div>
      </div>

      <div v-if="filtered.length" class="grid">
        <article v-for="r in filtered" :key="r.id" v-memo="[r, stats[r.id], now, deletingId]" class="rel" :class="{ 'is-deleting': deletingId === r.id }" tabindex="0" :aria-label="`Edit ${r.title} by ${r.artist}`" @click="openEditor(r)" @keydown.enter.self="openEditor(r)" @keydown.space.self.prevent="openEditor(r)">
          <div class="rel-cover">
            <img v-if="r.cover_url" :src="r.cover_url" :alt="r.title" loading="lazy" decoding="async" width="500" height="500" />
            <div v-else class="cover-ph"><span class="fm-logo"><span class="fm-prefix">fm</span>GATO</span></div>
            <span class="badge" :class="statusOf(r)">{{ badgeText(r) }}</span>

          </div>
          <div class="rel-body">
            <h3 class="title-serif rel-title">{{ r.title }}</h3>
            <p class="rel-meta">{{ r.artist }} · {{ formatShort(r.release_date) }}</p>
            <p class="status-line" :class="statusOf(r)">{{ badgeText(r) }}</p>
            <p v-if="stats[r.id]" class="rel-stats">{{ stats[r.id].views }} views · {{ stats[r.id].clicks }} clicks</p>
          </div>
          <StudioActions class="card-actions" overlay library :release-title="r.title" :label="`Actions for ${r.title}`" :href="`/${r.id}`" :disabled="!!deletingId"
            @edit="openEditor(r)" @links="openEditor(r, 'links')" @copy="copy(pageUrl(r.id))" @duplicate="duplicateRelease(r)" @delete="deleteRelease(r)" />
        </article>
      </div>
      <div v-else class="empty">
        <p>{{ releases.length ? 'No matching releases.' : 'Your first release starts here.' }}</p>
        <button v-if="search || filter !== 'all'" class="g-btn g-btn--sm" @click="search = ''; filter = 'all'">Clear filters</button>
        <button v-else class="g-btn g-btn--sm" @click="openEditor()"><Plus :size="17" aria-hidden="true" />Create release</button>
      </div>

    </main>

    <!-- editor drawer -->
    <Transition name="editor">
    <div v-if="showEditor" class="overlay" @click.self="closeEditor()">
      <aside ref="editorDialog" class="drawer" :inert="!!confirmState" role="dialog" aria-modal="true" :aria-label="isEditing ? 'Edit release' : 'New release'">
        <header class="drawer-head">
          <div>
            <h2 class="title-serif drawer-title">{{ isEditing ? current.title : 'New release' }}</h2>
            <p v-if="current.artist" class="editor-context">{{ current.artist }}</p>
          </div>
          <div class="editor-head-actions">
          <StudioActions v-if="isEditing" :release-title="current.title" label="Release actions" :href="`/${current.id}`" :disabled="editorBusy"
            @copy="copy(pageUrl(current.id))" @duplicate="duplicateRelease()" @delete="deleteRelease()" />
          <button class="icon-btn close-btn" :disabled="editorBusy" title="Close" aria-label="Close" @click="closeEditor()">
            <X :size="18" aria-hidden="true" />
          </button>
          </div>
        </header>

        <div class="editor-tabs" role="tablist" aria-label="Release editor">
          <button v-for="(tab, index) in editorTabs" :key="tab.id" :id="`editor-tab-${tab.id}`"
            class="editor-tab" role="tab" :aria-selected="editorTab === tab.id" :aria-controls="`editor-panel-${tab.id}`"
            :tabindex="editorTab === tab.id ? 0 : -1" @click="editorTab = tab.id"
            @keydown.down.prevent="editorTab = editorTabs[(index + 1) % editorTabs.length].id; nextTick(() => editorDialog.querySelector('[aria-selected=true]').focus())"
            @keydown.up.prevent="editorTab = editorTabs[(index + editorTabs.length - 1) % editorTabs.length].id; nextTick(() => editorDialog.querySelector('[aria-selected=true]').focus())"
            @keydown.right.prevent="editorTab = editorTabs[(index + 1) % editorTabs.length].id; nextTick(() => editorDialog.querySelector('[aria-selected=true]').focus())"
            @keydown.left.prevent="editorTab = editorTabs[(index + editorTabs.length - 1) % editorTabs.length].id; nextTick(() => editorDialog.querySelector('[aria-selected=true]').focus())">
            {{ tab.label }}<span v-if="tab.id === 'links' && filledLinkCount" class="tab-count">{{ filledLinkCount }}</span>
          </button>
        </div>
        <div ref="drawerBody" class="drawer-body">
          <div v-if="editorTab === 'release'" id="editor-panel-release" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-release">
            <!-- Smart fill -->
            <details class="fill" :open="!isEditing">
              <summary>Auto-fill from a music link <span aria-hidden="true">+</span></summary>
              <div class="fill-body">
              <div class="row">
                <input id="release-scan" aria-label="Find release metadata and links" v-model="scanInput" class="g-input" placeholder="ISRC, music link, or Artist - Title" autocapitalize="off" spellcheck="false" @keydown.enter.prevent="scan" />
                <button class="g-btn g-btn--primary" :disabled="isScanning" @click="scan"><Search :size="17" aria-hidden="true" />{{ isScanning ? '…' : 'Scan' }}</button>
              </div>
              <p v-if="isScanning" class="hint" role="status">{{ scanStep }}</p>
              <label class="check-row">
                <input type="checkbox" v-model="overwrite" /> Overwrite fields that are already filled
              </label>

              <div v-if="scanReport" class="report">
                <div v-for="i in scanReport.items" :key="i.id" class="report-row">
                  <span class="dot" :class="i.confidence"></span>
                  <strong>{{ i.label }}</strong>
                  <span class="muted">{{ i.source }}<template v-if="i.confidence === 'fuzzy'"> · verify</template><template v-if="!i.applied"> · kept your value</template></span>
                </div>
                <p v-if="scanReport.missing.length" class="hint">
                  Not found: {{ scanReport.missing.join(', ') }}. Find more platforms in Links.
                </p>
              </div>
              </div>
            </details>

            <!-- Basics -->
            <section class="block">
              <div class="grid-2">
                <div class="field"><label class="lbl" for="release-title">Title</label><input id="release-title" aria-required="true" v-model="current.title" class="g-input" /></div>
                <div class="field"><label class="lbl" for="release-artist">Artist</label><input id="release-artist" aria-required="true" v-model="current.artist" class="g-input" /></div>
              </div>
              <div class="grid-2">
                <div class="field">
                  <label class="lbl" for="release-slug">Page URL</label>
                  <input id="release-slug" aria-required="true" v-model="current.id" class="g-input" :disabled="isEditing" placeholder="artist-release" autocapitalize="off" spellcheck="false" @input="slugTouched = true" />
                </div>
                <div class="field">
                  <label class="lbl" for="release-date">Release date</label>
                  <input id="release-date" v-model="current.release_date" type="date" class="g-input" />
                </div>
              </div>
              <p class="hint">{{ dateHint }}</p>
              <div class="field">
                <label class="lbl" for="release-isrc">ISRC</label>
                <input id="release-isrc" v-model="current.isrc" class="g-input" placeholder="FR9W1…" autocapitalize="characters" spellcheck="false" />
              </div>
            </section>

            <section class="block settings-card tracklist-setting">
              <label class="setting-row" for="show-tracklist">
                <span class="setting-copy"><span class="setting-title">Tracklist <span v-if="trackCount" class="setting-count">{{ trackCount }} {{ trackCount === 1 ? 'track' : 'tracks' }}</span></span><span class="hint">One line per track.</span></span>
                <span class="switch"><input id="show-tracklist" v-model="current.show_tracklist" type="checkbox" aria-controls="tracklist-editor" /><span aria-hidden="true"></span></span>
              </label>
              <div v-if="current.show_tracklist" id="tracklist-editor" class="setting-content">
                <textarea v-model="current.tracklist" class="g-input tracklist-input" rows="5" aria-label="Tracklist" placeholder="Intro&#10;Track title&#10;Outro"></textarea>
                <p class="hint">Track numbers are added automatically.</p>
              </div>
            </section>

            <!-- Stats -->
            <section v-if="isEditing && (stats[current.id] || platformClicks.length)" class="block">
              <label class="lbl">Performance</label>
              <p v-if="stats[current.id]" class="perf">{{ stats[current.id].views }} views · {{ stats[current.id].clicks }} clicks</p>
              <div v-for="c in platformClicks" :key="c.platform" class="perf-row">
                <span>{{ clickLabel(c.platform) }}</span><strong>{{ c.clicks }}</strong>
              </div>
            </section>
          </div>
          <div v-show="editorTab === 'links'" id="editor-panel-links" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-links">
            <KeepAlive>
            <StudioLinks v-if="editorTab === 'links'" :key="editorSession" :links="current" :review-set="reviewSet" :busy="editorBusy" :search-query="searchQuery" :confirm-action="askConfirm"
              @change="updateLink" @review="reviewLink" @notify="showToast" @copy="copy" />
            </KeepAlive>
          </div>
          <div v-if="editorTab === 'appearance'" id="editor-panel-appearance" class="editor-panel" role="tabpanel" aria-labelledby="editor-tab-appearance">
            <!-- Artwork -->
            <section class="block">
              <label class="lbl">Artwork</label>
              <div class="art" :class="{ drag: dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
                <div class="art-preview">
                  <img v-if="current.cover_url" :src="current.cover_url" alt="" />
                  <span v-else>1:1</span>
                </div>
                <div class="art-side">
                  <button type="button" class="g-btn g-btn--sm" :disabled="isUploading" @click="editorDialog.querySelector('#cover-upload').click()"><Upload :size="17" aria-hidden="true" />{{ isUploading ? 'Processing…' : 'Choose image' }}</button>
                  <button v-if="current.cover_url" type="button" class="g-btn g-btn--sm g-btn--ghost remove-cover" :disabled="editorBusy" @click="current.cover_url = ''; selectedFileName = ''"><Trash2 :size="16" aria-hidden="true" />Remove cover</button>
                  <input id="cover-upload" type="file" accept="image/*" hidden :disabled="isUploading" @change="handleImageUpload" />
                  <span class="muted file">{{ selectedFileName || 'Square crop · optimised automatically' }}</span>
                </div>
              </div>
              <input aria-label="Artwork URL" v-model="current.cover_url" class="g-input" placeholder="Or paste an image URL…" inputmode="url" autocapitalize="off" />
            </section>

            <!-- Look -->
            <section class="block appearance-settings">
              <label class="lbl">Theme</label>
              <div class="seg">
                <label><input type="radio" v-model="current.theme" value="dark" /><span>Dark</span></label>
                <label><input type="radio" v-model="current.theme" value="light" /><span>Light</span></label>
              </div>
              <label class="setting-row settings-card blur-setting" for="cover-blur">
                <span class="setting-copy"><span class="setting-title">Blurred background</span><span class="hint">Use the artwork behind your page.</span></span>
                <span class="switch"><input id="cover-blur" type="checkbox" v-model="current.use_blur" /><span aria-hidden="true"></span></span>
              </label>

              <div v-if="palette" class="palette" :style="{ background: palette.bg }">
                <span class="swatch" :style="{ background: palette.accent }"></span>
                <span :style="{ color: palette.accent }">Page colour {{ palette.bg }}</span>
              </div>
              <p v-else-if="paletteError" class="hint warn">
                {{ paletteError }}
                <button class="link" :disabled="editorBusy" @click="rehostCover(current.cover_url)">Re-host cover</button>
              </p>
            </section>


          </div>
        </div>

        <footer class="drawer-foot">
          <p class="save-status" :class="{ dirty: isDirty }" role="status"><span class="status-dot" aria-hidden="true"></span>{{ isDirty ? 'Unsaved changes' : 'No changes' }}</p>
          <div class="save-actions">
            <button class="g-btn g-btn--ghost" :disabled="editorBusy" @click="closeEditor()">Cancel</button>
            <button class="g-btn g-btn--primary" :disabled="editorBusy || (isEditing && !isDirty)" @click="saveRelease">
              <LoaderCircle v-if="editorBusy" class="busy-icon" :size="17" aria-hidden="true" /><Check v-else :size="17" aria-hidden="true" />
              {{ deletingId ? 'Deleting…' : isSaving ? 'Saving…' : isUploading ? 'Uploading…' : isScanning ? 'Scanning…' : isEditing ? 'Save changes' : 'Publish release' }}
            </button>
          </div>
        </footer>
      </aside>
    </div>

    </Transition>

    <!-- confirm dialog -->
    <div v-if="confirmState" class="overlay overlay-top" @click.self="answerConfirm(false)">
      <div ref="confirmDialog" class="dialog g-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <h3 id="confirm-title" class="title-serif dialog-title">{{ confirmState.title }}</h3>
        <p id="confirm-message" class="dialog-msg">{{ confirmState.message }}</p>
        <div class="dialog-actions">
          <button class="g-btn g-btn--ghost" @click="answerConfirm(false)">Cancel</button>
          <button class="g-btn" :class="confirmState.danger ? 'g-btn--danger' : 'g-btn--primary'" @click="answerConfirm(true)">{{ confirmState.confirmLabel || 'OK' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin { width: 100%; box-sizing: border-box; }
.ico { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.muted { color: var(--fg-faint); }
.loading-state { min-height: 100dvh; display: grid; place-items: center; }
.logo-large { width: 72px; height: auto; }
.login-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
.login-card { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 380px; padding: 36px; text-align: center; }
.logo-login { width: 52px; margin: 0 auto 8px; }
.brand-huge { margin: 0; font-size: 3.4rem; }
.subtitle { margin: 0 0 16px; color: var(--fg-faint); font-size: 0.8rem; }

/* Library */
.wrap { max-width: 1180px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 24px) 32px calc(env(safe-area-inset-bottom, 0px) + 48px); box-sizing: border-box; }
.navbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.nav-brand, .nav-actions { display: flex; align-items: center; gap: 12px; }
.nav-brand { min-width: 0; }
.logo-small { width: 30px; height: 30px; object-fit: contain; }
.nav-title { font-size: 1.8rem; color: var(--fg); }
.nav-tag { padding-left: 14px; border-left: 1px solid var(--line); font-size: 0.76rem; color: var(--fg-faint); }
.nav-actions { gap: 8px; }
.nav-icon { border-color: transparent; }
.busy-icon { animation: g-spin 800ms linear infinite; }
.library-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 36px 0 28px; }
.library-head > div { min-width: 0; }
.library-title { font-size: 3rem; line-height: 1.05; }
.library-summary { margin: 10px 0 0; color: var(--fg-faint); font-size: 0.76rem; line-height: 1.5; overflow-wrap: anywhere; }
.new-btn { flex-shrink: 0; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
.search { max-width: 360px; min-width: 0; }
.chips { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 3px; border: 1px solid var(--line); border-radius: 100px; }
.chip { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 10px 14px; border: 0; border-radius: 100px; background: transparent; color: var(--fg-dim); font: 500 0.75rem var(--font-ui); text-transform: capitalize; cursor: pointer; transition: background 120ms, color 120ms; }
.chip.active { background: var(--surface-hover); color: var(--fg); }
.chip-n { color: var(--fg-faint); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.chip-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--warn); }
.chip-dot.live { background: var(--ok); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); align-items: start; gap: 30px 24px; }
.rel { position: relative; min-width: 0; cursor: pointer; border-radius: 16px; }
.rel-cover { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 16px; background: var(--surface); }
.rel-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-ph { height: 100%; display: grid; place-items: center; color: var(--fg-faint); font-size: 2rem; }
.badge { position: absolute; bottom: 12px; left: 12px; max-width: calc(100% - 24px); padding: 6px 9px; box-sizing: border-box; border-radius: 100px; background: rgba(15, 15, 17, 0.85); color: #f2efe9; font-size: 0.6rem; font-weight: 500; letter-spacing: 0.02em; }
.badge.live { background: #1b633d; }
.rel-body { padding: 13px 0 0; min-width: 0; }
.rel-title { margin: 0 0 6px; color: var(--fg); font-size: 1.55rem; line-height: 1.15; overflow-wrap: anywhere; }
.rel-meta { margin: 0; font-size: 0.74rem; line-height: 1.5; color: var(--fg-dim); }
.rel-stats { margin: 5px 0 0; color: var(--fg-faint); font-size: 0.68rem; }
.status-line { display: none; }
.rel:hover .card-actions, .rel:focus-within .card-actions { opacity: 1; pointer-events: auto; }
.card-actions { position: absolute; top: 10px; right: 10px; }
.rel.is-deleting { opacity: 0.45; pointer-events: none; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 20px; color: var(--fg-dim); text-align: center; font-size: 0.85rem; }

/* Editor workspace */
.overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: rgba(0, 0, 0, 0.62); }
.drawer { display: grid; grid-template-columns: 160px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; width: 100%; max-width: 900px; height: min(820px, calc(100dvh - 48px)); border: 1px solid var(--line); border-radius: 24px; background: var(--panel); color: var(--fg); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2); }
.drawer-head { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 92px; padding: 22px 28px; box-sizing: border-box; border-bottom: 1px solid var(--line); }
.drawer-head > div:first-child { min-width: 0; }
.drawer-title { font-size: 2.1rem; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-context { margin: 7px 0 0; color: var(--fg-faint); font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.icon-btn { display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; flex-shrink: 0; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--fg-dim); cursor: pointer; text-decoration: none; transition: background 120ms, color 120ms; }
.icon-btn:hover { background: var(--surface-hover); color: var(--fg); }
.icon-btn:disabled { opacity: 0.4; }
.editor-tabs { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 20px 12px; border-right: 1px solid var(--line); }
.editor-tab { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 11px 14px; border: 0; border-radius: 10px; background: transparent; color: var(--fg-dim); text-align: left; font: 500 0.8rem var(--font-ui); cursor: pointer; transition: background 120ms, color 120ms; }
.editor-tab[aria-selected="true"] { background: var(--surface-hover); color: var(--fg); }
.tab-count { font-size: 0.68rem; color: var(--fg-faint); font-variant-numeric: tabular-nums; }
.drawer-body { grid-column: 2; grid-row: 2; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 28px; }
.editor-panel { display: flex; flex-direction: column; gap: 24px; }
.drawer-foot { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 28px; border-top: 1px solid var(--line); }
.save-status { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--fg-faint); font-size: 0.72rem; }
.save-status.dirty { color: var(--warn); }
.status-dot { width: 5px; height: 5px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
.save-actions { display: flex; align-items: center; gap: 8px; }
.save-actions .g-btn--primary { min-width: 138px; }

/* Form rhythm */
.block, .fill-body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.lbl { display: block; color: var(--fg-dim); font-size: 0.75rem; font-weight: 500; }
.field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.row { display: flex; align-items: center; gap: 8px; }
.row > .g-input { flex: 1; min-width: 0; }
.hint { margin: 0; font-size: 0.7rem; line-height: 1.5; color: var(--fg-faint); }
.hint.warn { color: var(--warn); }
.check-row { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 0.72rem; color: var(--fg-dim); cursor: pointer; }
.check-row input { width: 18px; height: 18px; margin: 0; accent-color: var(--fg); }
.fill { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.fill summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 12px 16px; box-sizing: border-box; list-style: none; font-size: 0.78rem; font-weight: 500; cursor: pointer; }
.fill summary::-webkit-details-marker { display: none; }
.fill summary > span { font-size: 1.1rem; color: var(--fg-faint); }
.fill[open] summary > span { transform: rotate(45deg); }
.fill-body { padding: 0 16px 16px; gap: 10px; }
.report { display: flex; flex-direction: column; gap: 8px; }
.report-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; font-size: 0.72rem; }
.dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: var(--ok); }
.dot.fuzzy { background: var(--warn); }
.settings-card { border: 1px solid var(--line); border-radius: 14px; }
.block.settings-card { gap: 0; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 72px; padding: 16px; box-sizing: border-box; cursor: pointer; }
.setting-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.setting-title { color: var(--fg); font-size: 0.8rem; font-weight: 500; line-height: 1.4; }
.setting-count { color: var(--fg-faint); font-size: 0.68rem; font-weight: 400; margin-left: 6px; }
.setting-content { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 16px; }
.tracklist-input { min-height: 120px; resize: vertical; line-height: 1.6; }
.switch { position: relative; display: inline-flex; width: 38px; height: 22px; flex-shrink: 0; }
.switch input { position: absolute; inset: -11px -5px; width: 48px; height: 44px; opacity: 0; margin: 0; cursor: pointer; }
.switch > span { width: 100%; height: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 100px; background: var(--surface-hover); pointer-events: none; transition: background 120ms; }
.switch > span::after { content: ''; display: block; width: 14px; height: 14px; margin: 3px; border-radius: 50%; background: var(--fg-faint); transition: transform 120ms, background 120ms; }
.switch input:checked + span { background: var(--primary-bg); border-color: transparent; }
.switch input:checked + span::after { transform: translateX(16px); background: var(--primary-fg); }
.switch input:focus-visible + span { outline: 2px solid var(--fg); outline-offset: 4px; }
.art { display: flex; align-items: center; gap: 20px; padding: 18px; border: 1px dashed var(--line); border-radius: 14px; }
.art.drag { background: var(--surface-hover); border-color: var(--fg-dim); }
.art-preview { display: grid; place-items: center; width: 88px; height: 88px; flex-shrink: 0; overflow: hidden; border-radius: 10px; background: var(--surface); color: var(--fg-faint); font-size: 0.75rem; }
.art-preview img { width: 100%; height: 100%; object-fit: cover; }
.remove-cover { color: var(--danger); }
.art-side { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.file { font-size: 0.7rem; line-height: 1.5; overflow-wrap: anywhere; }
.seg { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--line); border-radius: 100px; }
.seg label { position: relative; flex: 1; }
.seg input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.seg span { display: flex; align-items: center; justify-content: center; min-height: 42px; border-radius: 100px; color: var(--fg-dim); font-size: 0.76rem; font-weight: 500; cursor: pointer; }
.seg input:checked + span { background: var(--primary-bg); color: var(--primary-fg); }
.seg input:focus-visible + span { outline: 2px solid var(--fg); outline-offset: 2px; }
.palette { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; font-size: 0.72rem; }
.swatch { width: 12px; height: 12px; border-radius: 50%; }
.link { padding: 0; border: 0; background: transparent; color: var(--fg); font: inherit; text-decoration: underline; cursor: pointer; }
.perf { margin: 0; font-size: 0.78rem; color: var(--fg-dim); }
.perf-row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 0.75rem; color: var(--fg-dim); }
.perf-row strong { color: var(--fg); }

/* Confirmations and restrained motion */
.overlay-top { z-index: 2000; }
.dialog { width: 100%; max-width: 400px; padding: 28px; }
.dialog-title { font-size: 2rem; line-height: 1.1; margin: 0 0 12px; }
.dialog-msg { margin: 0 0 24px; font-size: 0.82rem; color: var(--fg-dim); line-height: 1.6; }
.dialog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.editor-enter-active, .editor-leave-active { transition: opacity 140ms; }
.editor-enter-active .drawer, .editor-leave-active .drawer { transition: transform 180ms ease-out; }
.editor-enter-from, .editor-leave-to { opacity: 0; }
.editor-enter-from .drawer, .editor-leave-to .drawer { transform: translateY(8px); }
.toast-enter-active, .toast-leave-active { transition: opacity 140ms; }
.toast-enter-from, .toast-leave-to { opacity: 0; }

@media (max-width: 800px) {
  .wrap { padding-left: 24px; padding-right: 24px; }
  .drawer { grid-template-columns: 136px minmax(0, 1fr); }
  .drawer-head { padding: 20px 24px; }
  .drawer-body { padding: 24px; }
  .drawer-foot { padding: 16px 24px; }
  .editor-tabs { padding: 16px 8px; }
  .toolbar { gap: 16px; }
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-2 { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .wrap { padding: calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 32px); }
  .navbar { padding-bottom: 18px; gap: 8px; }
  .nav-brand { gap: 8px; }
  .nav-title { font-size: 1.55rem; }
  .nav-tag { display: none; }
  .logo-small { width: 26px; height: 26px; }
  .nav-actions .g-btn { padding: 9px 10px; }
  .library-head { margin: 28px 0 22px; align-items: flex-start; gap: 12px; }
  .library-title { font-size: 2.5rem; }
  .library-summary { font-size: 0.7rem; }
  .new-btn { margin-top: 2px; padding: 10px 15px; }
  .toolbar { flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 20px; }
  .search { max-width: none; }
  .chips { align-self: flex-start; max-width: 100%; box-sizing: border-box; }
  .chip { min-height: 40px; padding: 10px 13px; }
  .grid { grid-template-columns: 1fr; gap: 8px; }
  .rel { display: grid; grid-template-columns: 64px minmax(0, 1fr) 36px; gap: 14px; align-items: center; padding: 12px; border: 1px solid var(--line); border-radius: 16px; }
  .rel-cover { width: 64px; border-radius: 10px; }
  .rel-body { padding: 0; }
  .rel-title { margin: 0 0 4px; font-size: 1.35rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .rel-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; }
  .rel-stats { font-size: 0.65rem; }
  .badge { display: none; }
  .status-line { display: block; margin: 5px 0 0; font-size: 0.6rem; color: var(--warn); }
  .status-line.live { color: var(--ok); }
  .card-actions { position: relative; top: auto; right: auto; justify-self: center; align-self: start; }
  .overlay { padding: 0; }
  .drawer { display: flex; flex-direction: column; max-width: none; height: 100dvh; border: 0; border-radius: 0; box-shadow: none; }
  .drawer-head { min-height: 80px; padding: calc(env(safe-area-inset-top, 0px) + 16px) 18px 16px; gap: 12px; flex-shrink: 0; }
  .drawer-title { font-size: 1.9rem; }
  .editor-head-actions { gap: 4px; }
  .editor-tabs { flex-direction: row; gap: 4px; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .editor-tab { flex: 1; justify-content: center; gap: 6px; padding: 10px 8px; font-size: 0.78rem; }
  .drawer-body { flex: 1; padding: 22px 18px; }
  .drawer-foot { padding: 12px 18px calc(env(safe-area-inset-bottom, 0px) + 12px); gap: 12px; flex-shrink: 0; }
  .save-status { font-size: 0.65rem; }
  .save-actions { gap: 4px; }
  .save-actions .g-btn { padding: 11px 14px; font-size: 0.75rem; }
  .save-actions .g-btn--primary { min-width: 0; }
  .art { gap: 14px; padding: 14px; }
  .art-preview { width: 72px; height: 72px; }
  .overlay-top { padding: 20px; }
  .dialog { padding: 24px; }
}
@media (max-width: 380px) {
  .save-status { max-width: 60px; line-height: 1.4; }
  .library-summary > span { display: none; }
  .chip { padding-left: 11px; padding-right: 11px; }
  .setting-count { display: block; margin: 2px 0 0; }
}
</style>
