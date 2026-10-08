<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { supabase } from '../supabase'
import { PLATFORMS, PRESAVE, LINK_COLUMNS, platformById, platformFromUrl, normalizeUrl, searchUrl } from '../lib/platforms'
import { toYMD, zurichMidnight, isLive, relativeTo, formatShort } from '../lib/releaseDate'
import { detectInput, runScan, cleanIsrc } from '../lib/scan'
import { loadPalette } from '../lib/palette'
import { useSystemChrome } from '../composables/useSystemChrome'
import logoUrl from '../assets/gato_logo.png'

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
const hasStats = computed(() => Object.keys(stats.value).length > 0)

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
  if (error || !data) return // table/view not created yet: stats simply stay hidden
  stats.value = Object.fromEntries(data.map((s) => [s.release_id, { views: Number(s.views), clicks: Number(s.clicks) }]))
}

const loadAll = () => Promise.all([fetchReleases(), fetchStats()])

/* ---- live clock: statuses flip at Swiss midnight without a reload ---- */
const now = ref(Date.now())
let clock

const statusOf = (r) => (isLive(r.release_date, now.value) ? 'live' : 'upcoming')
const badgeText = (r) => (statusOf(r) === 'live' ? 'LIVE' : `UPCOMING · ${relativeTo(r.release_date, now.value)}`)

const counts = computed(() => ({
  all: releases.value.length,
  upcoming: releases.value.filter((r) => statusOf(r) === 'upcoming').length,
  live: releases.value.filter((r) => statusOf(r) === 'live').length
}))

const nextRelease = computed(() =>
  releases.value.filter((r) => statusOf(r) === 'upcoming').sort((a, b) => a.release_date.localeCompare(b.release_date))[0]
)

const totals = computed(() => {
  let views = 0, clicks = 0
  for (const s of Object.values(stats.value)) { views += s.views; clicks += s.clicks }
  return { views, clicks }
})

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
      if (sa !== sb) return sa === 'upcoming' ? -1 : 1 // upcoming first
      if (sa === 'upcoming') return a.release_date.localeCompare(b.release_date) // soonest first
      return (b.release_date || '').localeCompare(a.release_date || '') // newest first
    })
})

/* ============================== editor ============================== */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED = new Set(['admin', 'callback', 'api', 'assets', 'src'])

const slugify = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const emptyRelease = () => ({
  id: '', isrc: '', title: '', artist: '', cover_url: '', release_date: '',
  use_blur: true, theme: 'dark',
  ...Object.fromEntries(LINK_COLUMNS.map((c) => [c, '']))
})

const showEditor = ref(false)
const isEditing = ref(false)
const isSaving = ref(false)
const current = ref(emptyRelease())
const snapshot = ref('')
const slugTouched = ref(false)
const isDirty = computed(() => showEditor.value && JSON.stringify(current.value) !== snapshot.value)

const scanInput = ref('')
const isScanning = ref(false)
const scanStep = ref('')
const scanReport = ref(null)
const overwrite = ref(false)
const reviewSet = ref(new Set())
const pasteText = ref('')
const palette = ref(null)
const paletteError = ref('')
const platformClicks = ref([])
const selectedFileName = ref('')
const isUploading = ref(false)
const dragging = ref(false)

const resetEditorState = () => {
  scanReport.value = null
  reviewSet.value = new Set()
  pasteText.value = ''
  palette.value = null
  paletteError.value = ''
  platformClicks.value = []
  selectedFileName.value = ''
  overwrite.value = false
}

const openEditor = (release = null) => {
  const defaults = emptyRelease()
  const base = { ...defaults }
  // DB rows contain nulls for empty fields: keep the defaults instead of letting null through
  if (release) for (const k of Object.keys(defaults)) if (release[k] !== null && release[k] !== undefined) base[k] = release[k]
  current.value = base
  isEditing.value = !!release
  slugTouched.value = !!release
  snapshot.value = JSON.stringify(base)
  scanInput.value = base.isrc || ''
  resetEditorState()
  showEditor.value = true
  if (release) loadPlatformClicks(release.id)
}

const duplicateRelease = () => {
  const copy = {
    ...current.value,
    isrc: '',
    release_date: '',
    title: current.value.title
  }
  copy.id = slugify(`${copy.artist} ${copy.title}`) + '-2'
  current.value = copy
  isEditing.value = false
  slugTouched.value = false
  snapshot.value = ''
  resetEditorState()
  showToast('Duplicated. Set a new title, slug and date.', 'info')
}

const closeEditor = async (force = false) => {
  if (!force && isDirty.value) {
    const discard = await askConfirm({ title: 'Discard changes?', message: 'You have unsaved changes in this release.', confirmLabel: 'Discard', danger: true })
    if (!discard) return
  }
  showEditor.value = false
}

// slug follows "artist title" until you edit it yourself
watch(() => [current.value.artist, current.value.title], () => {
  if (!isEditing.value && !slugTouched.value) current.value.id = slugify(`${current.value.artist} ${current.value.title}`)
})

watch(showEditor, (open) => { document.body.style.overflow = open ? 'hidden' : '' })

/* ---- date hint ---- */
const dateHint = computed(() => {
  const ymd = current.value.release_date
  if (!ymd) return 'No date: the page goes live immediately.'
  const t = zurichMidnight(ymd)
  const local = new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return now.value >= t
    ? `Live since 00:00 Swiss time (${local} your time).`
    : `Goes live at 00:00 Swiss time (${local} your time).`
})

/* ---- links ---- */
const searchQuery = computed(() => `${current.value.artist} ${current.value.title}`.trim())

const mismatchLabel = (p) => {
  const v = current.value[p.column]
  if (!v) return ''
  const detected = platformFromUrl(v)
  return detected && detected !== p.id ? platformById(detected).label : ''
}

const sortPasted = () => {
  const tokens = pasteText.value.split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return
  let ok = 0
  const unknown = []
  for (const t of tokens) {
    const url = normalizeUrl(t)
    const id = platformFromUrl(url)
    if (id) {
      const col = platformById(id).column
      current.value[col] = url
      reviewSet.value.delete(col)
      ok++
    } else unknown.push(t)
  }
  pasteText.value = unknown.join('\n')
  if (ok) showToast(`${ok} link${ok > 1 ? 's' : ''} sorted into the right fields.`, 'success')
  if (unknown.length) showToast(`${unknown.length} link${unknown.length > 1 ? 's' : ''} not recognised.`, unknown.length === tokens.length ? 'error' : 'info')
}

/* ---- smart fill ---- */
const scan = async () => {
  const input = detectInput(scanInput.value)
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

/* ---- artwork ---- */
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
    // Safari can't encode WebP: fall back to JPEG instead of silently producing a huge PNG
    const type = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const uploadCover = async (file) => {
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

// Copies a remote cover into your own storage (square, compressed, CORS-safe for colour extraction)
const rehostCover = async (url, silent = false) => {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await uploadCover(await res.blob())
  } catch {
    if (!silent) showToast("This host doesn't allow downloading the image. Upload the file instead.", 'error')
  }
}

/* ---- colour preview ---- */
let paletteTimer
watch(() => [showEditor.value, current.value.cover_url, current.value.theme], () => {
  clearTimeout(paletteTimer)
  if (!showEditor.value || !current.value.cover_url) {
    palette.value = null
    paletteError.value = ''
    return
  }
  paletteTimer = setTimeout(async () => {
    try {
      palette.value = await loadPalette(current.value.cover_url, current.value.theme !== 'light')
      paletteError.value = ''
    } catch {
      palette.value = null
      paletteError.value = "The public page can't read colours from this image (host blocks CORS)."
    }
  }, 400)
})

/* ---- per-release analytics ---- */
const loadPlatformClicks = async (id) => {
  const { data } = await supabase.from('release_clicks_by_platform').select('platform, clicks').eq('release_id', id).order('clicks', { ascending: false })
  platformClicks.value = data || []
}

const clickLabel = (key) => {
  if (key.startsWith('presave-')) return `${platformById(key.slice(8))?.label || key.slice(8)} (pre-save)`
  return platformById(key)?.label || (key === 'share' ? 'Share button' : key)
}

/* ---- save / delete ---- */
const saveRelease = async () => {
  if (isSaving.value) return
  const c = current.value
  c.id = c.id.trim()
  if (!c.title.trim() || !c.artist.trim()) return showToast('Title and artist are required.', 'error')
  if (!SLUG_RE.test(c.id) || RESERVED.has(c.id)) return showToast('Slug: lowercase letters, numbers and dashes only.', 'error')

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
      release_date: c.release_date || null, // plain YYYY-MM-DD, interpreted as 00:00 Swiss time
      use_blur: c.use_blur,
      theme: c.theme
    }
    const { error: relError } = await supabase.from('releases').upsert(releaseRow)
    if (relError) throw relError

    const linksRow = { release_id: c.id }
    for (const col of LINK_COLUMNS) linksRow[col] = normalizeUrl(c[col]) || null
    const { error: linkError } = await supabase.from('links').upsert(linksRow, { onConflict: 'release_id' })
    if (linkError) throw linkError

    await loadAll()
    snapshot.value = JSON.stringify(current.value)
    showEditor.value = false
    showToast('Saved.', 'success')
  } catch (err) {
    console.error(err)
    if (err.message === 'slug-taken') showToast('That slug is already used by another release.', 'error')
    else if (err.code === 'PGRST204' || /column/i.test(err.message || '')) showToast('Database is missing the new columns. Run supabase/migration.sql first.', 'error')
    else showToast('Could not save.', 'error')
  }
  isSaving.value = false
}

const deleteRelease = async () => {
  const c = current.value
  const ok = await askConfirm({
    title: 'Delete release?',
    message: `"${c.title}" and all its links will be removed permanently.`,
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  const a = await supabase.from('links').delete().eq('release_id', c.id)
  const b = await supabase.from('releases').delete().eq('id', c.id)
  if (a.error || b.error) return showToast('Could not delete.', 'error')
  await loadAll()
  showEditor.value = false
  showToast('Release deleted.', 'success')
}

/* ---- helpers ---- */
const pageUrl = (id) => `${window.location.origin}/${id}`
const copy = async (text, msg = 'Link copied.') => {
  try {
    await navigator.clipboard.writeText(text)
    showToast(msg, 'success')
  } catch {
    window.prompt('Copy this link', text)
  }
}

/* ---- keyboard + lifecycle ---- */
const onKey = (e) => {
  if (!showEditor.value) return
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
    <div class="g-stage" aria-hidden="true"></div>

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
        <p class="subtitle">Label Studio</p>
        <input v-model="email" type="email" placeholder="Email" class="g-input" autocomplete="username" />
        <input v-model="password" type="password" placeholder="Password" class="g-input" autocomplete="current-password" />
        <button type="submit" class="g-btn g-btn--primary g-btn--block" :disabled="isLoggingIn">
          {{ isLoggingIn ? 'Connecting…' : 'Connect' }}
        </button>
      </form>
    </main>

    <!-- dashboard -->
    <div v-else class="wrap">
      <nav class="navbar">
        <div class="nav-brand">
          <img :src="logoUrl" alt="" class="logo-small" />
          <h1 class="fm-logo nav-title"><span class="fm-prefix">fm</span>GATO</h1>
          <span class="nav-tag">Label Studio</span>
        </div>
        <div class="nav-actions">
          <button class="g-btn g-btn--sm g-btn--ghost" @click="toggleTheme" :aria-label="adminTheme === 'dark' ? 'Switch to light' : 'Switch to dark'">
            {{ adminTheme === 'dark' ? 'Light' : 'Dark' }}
          </button>
          <button class="g-btn g-btn--sm g-btn--ghost" @click="handleLogout">Logout</button>
        </div>
      </nav>

      <section class="tiles">
        <div class="tile"><span class="tile-n">{{ counts.all }}</span><span class="tile-l">Releases</span></div>
        <div class="tile">
          <span class="tile-n">{{ counts.upcoming }}</span><span class="tile-l">Upcoming</span>
          <span v-if="nextRelease" class="tile-s">Next: {{ nextRelease.title }} {{ relativeTo(nextRelease.release_date, now) }}</span>
        </div>
        <div class="tile"><span class="tile-n">{{ counts.live }}</span><span class="tile-l">Live</span></div>
        <template v-if="hasStats">
          <div class="tile"><span class="tile-n">{{ totals.views }}</span><span class="tile-l">Page views</span></div>
          <div class="tile"><span class="tile-n">{{ totals.clicks }}</span><span class="tile-l">Link clicks</span></div>
        </template>
      </section>

      <header class="toolbar">
        <div class="toolbar-left">
          <input v-model="search" class="g-input search" type="search" placeholder="Search title, artist, slug…" />
          <div class="chips" role="tablist">
            <button v-for="f in ['all', 'upcoming', 'live']" :key="f" class="chip" :class="{ active: filter === f }" @click="filter = f">
              {{ f }}<span class="chip-n">{{ counts[f] }}</span>
            </button>
          </div>
        </div>
        <button class="g-btn g-btn--primary" @click="openEditor(null)">+ New release</button>
      </header>

      <div v-if="filtered.length" class="grid">
        <article v-for="r in filtered" :key="r.id" class="rel" tabindex="0" @click="openEditor(r)" @keydown.enter="openEditor(r)">
          <div class="rel-cover">
            <img v-if="r.cover_url" :src="r.cover_url" :alt="r.title" loading="lazy" />
            <div v-else class="cover-ph"><span class="fm-logo"><span class="fm-prefix">fm</span>GATO</span></div>
            <span class="badge" :class="statusOf(r)">{{ badgeText(r) }}</span>
            <div class="rel-actions">
              <button class="icon-btn" title="Copy link" @click.stop="copy(pageUrl(r.id))">⧉</button>
              <a class="icon-btn" title="Open page" :href="`/${r.id}`" target="_blank" rel="noopener" @click.stop>↗</a>
            </div>
          </div>
          <h3 class="title-serif rel-title">{{ r.title }}</h3>
          <p class="rel-meta">{{ r.artist }} · {{ formatShort(r.release_date) }}</p>
          <p v-if="stats[r.id]" class="rel-stats">{{ stats[r.id].views }} views · {{ stats[r.id].clicks }} clicks</p>
        </article>
      </div>
      <p v-else class="empty">{{ releases.length ? 'No release matches.' : 'No releases yet. Create your first one.' }}</p>

      <footer class="footer">
        <span class="powered-text">POWERED BY</span>
        <span class="fm-logo"><span class="fm-prefix">fm</span>GATO</span>
      </footer>
    </div>

    <!-- editor drawer -->
    <div v-if="showEditor" class="overlay" @click.self="closeEditor()">
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="isEditing ? 'Edit release' : 'New release'">
        <header class="drawer-head">
          <div>
            <h2 class="title-serif drawer-title">{{ isEditing ? 'Edit' : 'Create' }}</h2>
            <p v-if="isDirty" class="dirty">● Unsaved changes</p>
          </div>
          <button class="g-btn g-btn--sm g-btn--ghost" @click="closeEditor()">✕ Close</button>
        </header>

        <div class="drawer-body">
          <!-- Smart fill -->
          <section class="block fill">
            <label class="lbl">Smart fill</label>
            <div class="row">
              <input v-model="scanInput" class="g-input" placeholder="ISRC, Deezer / Apple Music link, or Artist - Title" autocapitalize="off" spellcheck="false" @keydown.enter.prevent="scan" />
              <button class="g-btn g-btn--primary" :disabled="isScanning" @click="scan">{{ isScanning ? '…' : 'Scan' }}</button>
            </div>
            <p v-if="isScanning" class="hint">{{ scanStep }}</p>
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
                Not found: {{ scanReport.missing.join(', ') }}. Use the ⌕ button next to a field to search it manually.
              </p>
            </div>
          </section>

          <!-- Basics -->
          <section class="block">
            <div class="grid-2">
              <div class="field"><label class="lbl">Title *</label><input v-model="current.title" class="g-input" /></div>
              <div class="field"><label class="lbl">Artist *</label><input v-model="current.artist" class="g-input" /></div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="lbl">URL slug *</label>
                <div class="row">
                  <input v-model="current.id" class="g-input" :disabled="isEditing" autocapitalize="off" spellcheck="false" @input="slugTouched = true" />
                  <button v-if="isEditing" class="g-btn g-btn--sm" title="Copy link" @click="copy(pageUrl(current.id))">Copy</button>
                  <a v-if="isEditing" class="g-btn g-btn--sm" :href="`/${current.id}`" target="_blank" rel="noopener">Open</a>
                </div>
              </div>
              <div class="field">
                <label class="lbl">Release date</label>
                <input v-model="current.release_date" type="date" class="g-input" />
              </div>
            </div>
            <p class="hint">{{ dateHint }}</p>
            <div class="field">
              <label class="lbl">ISRC</label>
              <input v-model="current.isrc" class="g-input" placeholder="FR9W1…" autocapitalize="characters" spellcheck="false" />
            </div>
          </section>

          <!-- Artwork -->
          <section class="block">
            <label class="lbl">Artwork</label>
            <div class="art" :class="{ drag: dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
              <div class="art-preview">
                <img v-if="current.cover_url" :src="current.cover_url" alt="" />
                <span v-else>1:1</span>
              </div>
              <div class="art-side">
                <label for="cover-upload" class="g-btn g-btn--sm" :class="{ busy: isUploading }">{{ isUploading ? 'Processing…' : 'Choose or drop image' }}</label>
                <input id="cover-upload" type="file" accept="image/*" hidden :disabled="isUploading" @change="handleImageUpload" />
                <span class="muted file">{{ selectedFileName || 'Cropped to a square, compressed automatically.' }}</span>
              </div>
            </div>
            <input v-model="current.cover_url" class="g-input" placeholder="Or paste an image URL…" inputmode="url" autocapitalize="off" />
          </section>

          <!-- Look -->
          <section class="block">
            <label class="lbl">Page look</label>
            <div class="seg">
              <label><input type="radio" v-model="current.theme" value="dark" /><span>Dark</span></label>
              <label><input type="radio" v-model="current.theme" value="light" /><span>Light</span></label>
            </div>
            <label class="check-row"><input type="checkbox" v-model="current.use_blur" /> Blurred cover background</label>

            <div v-if="palette" class="palette" :style="{ background: palette.bg }">
              <span class="swatch" :style="{ background: palette.accent }"></span>
              <span :style="{ color: palette.accent }">Page colour {{ palette.bg }}</span>
            </div>
            <p v-else-if="paletteError" class="hint warn">
              {{ paletteError }}
              <button class="link" @click="rehostCover(current.cover_url)">Re-host cover</button>
            </p>
          </section>

          <!-- Pre-save -->
          <section class="block">
            <label class="lbl">Custom pre-save links <span class="muted">(optional)</span></label>
            <div class="grid-2">
              <div v-for="p in PRESAVE" :key="p.id" class="field">
                <label class="sub">{{ p.label }}</label>
                <input v-model="current[p.column]" class="g-input" placeholder="https://" inputmode="url" autocapitalize="off" spellcheck="false" />
              </div>
            </div>
            <p class="hint">Without a Spotify link here, visitors use the built-in Spotify pre-save.</p>
          </section>

          <!-- Streaming links -->
          <section class="block">
            <label class="lbl">Streaming links</label>

            <div class="paste">
              <textarea v-model="pasteText" class="g-input" rows="2" placeholder="Paste several links here (any platform). They get sorted into the right fields."></textarea>
              <button class="g-btn g-btn--sm" :disabled="!pasteText.trim()" @click="sortPasted">Sort links</button>
            </div>

            <div v-for="p in PLATFORMS" :key="p.id" class="link-row">
              <span class="link-ico" :style="{ color: p.mono ? 'var(--fg)' : p.brand }">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path v-if="p.icon.path" fill="currentColor" fill-rule="evenodd" :d="p.icon.path" />
                  <text v-else x="12" y="17.5" text-anchor="middle" font-size="16" font-weight="800" fill="currentColor">{{ p.icon.letter }}</text>
                </svg>
              </span>
              <div class="link-field">
                <label class="sub">
                  {{ p.label }}
                  <span v-if="reviewSet.has(p.column)" class="tag warn">verify</span>
                  <span v-else-if="mismatchLabel(p)" class="tag warn">looks like {{ mismatchLabel(p) }}</span>
                </label>
                <input v-model="current[p.column]" class="g-input" placeholder="https://" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" @input="reviewSet.delete(p.column)" />
              </div>
              <a v-if="current[p.column]" class="icon-btn" title="Open link" :href="current[p.column]" target="_blank" rel="noopener" @click="reviewSet.delete(p.column)">↗</a>
              <a v-else class="icon-btn" :class="{ disabled: !searchQuery }" :title="`Search on ${p.label}`" :href="searchUrl(p.id, searchQuery)" target="_blank" rel="noopener">⌕</a>
            </div>
          </section>

          <!-- Artist -->
          <section class="block">
            <label class="lbl">Artist profile <span class="muted">(shown as "Listen to …")</span></label>
            <input v-model="current.artist_url" class="g-input" placeholder="https://open.spotify.com/artist/…" inputmode="url" autocapitalize="off" spellcheck="false" />
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

        <footer class="drawer-foot">
          <div class="foot-main">
            <button class="g-btn g-btn--primary g-btn--block" :disabled="isSaving" @click="saveRelease">
              {{ isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Publish release' }}
            </button>
            <span class="kbd">⌘S</span>
          </div>
          <div v-if="isEditing" class="foot-sub">
            <button class="g-btn g-btn--sm g-btn--ghost" @click="duplicateRelease">Duplicate</button>
            <button class="g-btn g-btn--sm g-btn--danger" @click="deleteRelease">Delete</button>
          </div>
        </footer>
      </aside>
    </div>

    <!-- confirm dialog -->
    <div v-if="confirmState" class="overlay overlay-top" @click.self="answerConfirm(false)">
      <div class="dialog g-card" role="alertdialog" aria-modal="true">
        <h3 class="title-serif dialog-title">{{ confirmState.title }}</h3>
        <p class="dialog-msg">{{ confirmState.message }}</p>
        <div class="dialog-actions">
          <button class="g-btn g-btn--ghost" @click="answerConfirm(false)">Cancel</button>
          <button class="g-btn" :class="confirmState.danger ? 'g-btn--danger' : 'g-btn--primary'" @click="answerConfirm(true)">{{ confirmState.confirmLabel || 'OK' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin { --pad: 24px; }
.muted { color: var(--fg-faint); font-weight: 500; }
.pulse { animation: g-pulse 1.5s infinite alternate; }

.loading-state { position: fixed; inset: 0; display: grid; place-items: center; z-index: 100000; background: var(--page-bg); }
.logo-large { width: 120px; height: auto; }

/* ---------- login ---------- */
.login-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 20px; box-sizing: border-box; }
.login-card { width: 100%; max-width: 380px; padding: 44px 34px; text-align: center; display: flex; flex-direction: column; gap: 12px; animation: g-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.logo-login { width: 60px; height: auto; margin: 0 auto; }
.brand-huge { font-size: 3.8rem; line-height: 1; margin: 4px auto 0; color: var(--fg); }
.subtitle { margin: 0 0 12px; font-size: 0.7rem; letter-spacing: 3px; text-transform: uppercase; color: var(--fg-faint); }

/* ---------- dashboard ---------- */
.wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 20px) var(--pad) calc(env(safe-area-inset-bottom, 0px) + 32px); }
.navbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 22px; border-bottom: 1px solid var(--line); margin-bottom: 26px; }
.nav-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.logo-small { width: 32px; height: auto; }
.nav-title { font-size: 2rem; margin: 0; color: var(--fg); }
.nav-tag { font-size: 0.58rem; letter-spacing: 2px; text-transform: uppercase; font-weight: 800; color: var(--fg-faint); }
.nav-actions { display: flex; gap: 8px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 28px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 16px 18px; border-radius: 20px; background: var(--surface); border: 1px solid var(--line); }
.tile-n { font-family: "Instrument Serif", serif; font-size: 2.2rem; line-height: 1; color: var(--fg); }
.tile-l { font-size: 0.6rem; letter-spacing: 2px; text-transform: uppercase; font-weight: 800; color: var(--fg-faint); }
.tile-s { margin-top: 4px; font-size: 0.68rem; color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 26px; }
.toolbar-left { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; flex: 1; min-width: 0; }
.search { max-width: 280px; }
.chips { display: flex; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 100px; border: 1px solid var(--line); background: transparent; color: var(--fg-dim); font-family: var(--font-ui); font-size: 0.62rem; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
.chip.active { background: var(--primary-bg); color: var(--primary-fg); border-color: transparent; }
.chip-n { opacity: 0.6; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 34px 22px; }
.rel { cursor: pointer; outline: none; }
.rel-cover { position: relative; aspect-ratio: 1 / 1; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 14px 30px -18px rgba(0, 0, 0, 0.5); transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); margin-bottom: 12px; }
.rel-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 1.6rem; color: var(--fg-faint); }
.rel:focus-visible .rel-cover { outline: 2px solid var(--fg-dim); outline-offset: 3px; }
@media (hover: hover) and (pointer: fine) { .rel:hover .rel-cover { transform: translateY(-3px); } .rel:hover .rel-actions { opacity: 1; } }

.badge { position: absolute; top: 10px; left: 10px; padding: 5px 10px; border-radius: 100px; font-size: 0.52rem; font-weight: 800; letter-spacing: 1.2px; background: rgba(0, 0, 0, 0.55); color: #fff; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.badge.live { background: rgba(26, 127, 69, 0.85); }
.rel-actions { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s; }
@media (hover: none) { .rel-actions { opacity: 1; } }
.rel-title { font-size: 1.55rem; line-height: 1.1; color: var(--fg); margin: 0 0 4px; }
.rel-meta { margin: 0; font-size: 0.66rem; letter-spacing: 1px; text-transform: uppercase; color: var(--fg-dim); }
.rel-stats { margin: 4px 0 0; font-size: 0.62rem; letter-spacing: 0.5px; color: var(--fg-faint); }
.empty { text-align: center; padding: 60px 0; color: var(--fg-faint); font-size: 0.8rem; letter-spacing: 1px; }

.icon-btn { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; font-size: 0.95rem; text-decoration: none; cursor: pointer; border: 1px solid var(--line); background: var(--panel); color: var(--fg); transition: background 0.2s, transform 0.2s; flex-shrink: 0; }
.icon-btn:active { transform: scale(0.92); }
.icon-btn.disabled { opacity: 0.4; pointer-events: none; }
@media (hover: hover) and (pointer: fine) { .icon-btn:hover { background: var(--surface-hover); } }

.footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; justify-content: center; align-items: center; gap: 10px; color: var(--fg-dim); }
.powered-text { font-size: 0.7rem; letter-spacing: 2px; font-weight: bold; opacity: 0.7; }
.footer .fm-logo { font-size: 1.5rem; }

/* ---------- drawer ---------- */
.overlay { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: flex-end; background: rgba(0, 0, 0, 0.45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.overlay-top { z-index: 2000; justify-content: center; align-items: center; padding: 20px; }
.drawer { width: 100%; max-width: 560px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box; background: var(--panel); color: var(--fg); border-left: 1px solid var(--line); border-radius: 28px 0 0 28px; animation: slide-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
.drawer-head { display: flex; justify-content: space-between; align-items: center; padding: calc(env(safe-area-inset-top, 0px) + 22px) 28px 18px; border-bottom: 1px solid var(--line); }
.drawer-title { font-size: 2.2rem; line-height: 1; color: var(--fg); }
.dirty { margin: 4px 0 0; font-size: 0.62rem; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 800; color: var(--warn); }
.drawer-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 22px 28px 30px; display: flex; flex-direction: column; gap: 26px; }
.drawer-foot { padding: 16px 28px calc(env(safe-area-inset-bottom, 0px) + 16px); border-top: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; gap: 10px; }
.foot-main { display: flex; align-items: center; gap: 12px; }
.kbd { font-size: 0.62rem; letter-spacing: 1px; color: var(--fg-faint); white-space: nowrap; }
@media (hover: none) { .kbd { display: none; } }
.foot-sub { display: flex; justify-content: space-between; }

.block { display: flex; flex-direction: column; gap: 12px; }
.lbl { font-size: 0.62rem; letter-spacing: 2px; text-transform: uppercase; font-weight: 800; color: var(--fg-dim); }
.sub { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 0.6rem; letter-spacing: 1.2px; text-transform: uppercase; font-weight: 700; color: var(--fg-faint); }
.field { display: flex; flex-direction: column; min-width: 0; }
.field > .lbl { margin-bottom: 6px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.row { display: flex; gap: 8px; align-items: center; }
.hint { margin: 0; font-size: 0.68rem; line-height: 1.5; color: var(--fg-faint); }
.hint.warn { color: var(--warn); }
.check-row { display: flex; align-items: center; gap: 10px; font-size: 0.74rem; color: var(--fg-dim); cursor: pointer; }
.check-row input { accent-color: var(--fg); width: 16px; height: 16px; margin: 0; }
.link { background: none; border: none; padding: 0; margin-left: 6px; font: inherit; font-weight: 800; color: var(--fg); text-decoration: underline; cursor: pointer; }

.fill { padding: 18px; border-radius: 20px; background: var(--surface); border: 1px solid var(--line); }
.report { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; }
.report-row { display: flex; align-items: center; gap: 8px; font-size: 0.74rem; }
.report-row strong { font-weight: 700; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex-shrink: 0; }
.dot.fuzzy { background: var(--warn); }

.art { display: flex; gap: 16px; align-items: center; padding: 14px; border-radius: 18px; border: 1px dashed var(--line); transition: background 0.2s, border-color 0.2s; }
.art.drag { background: var(--surface-hover); border-color: var(--fg-dim); }
.art-preview { width: 88px; height: 88px; flex-shrink: 0; border-radius: 12px; overflow: hidden; display: grid; place-items: center; background: var(--surface); color: var(--fg-faint); font-size: 0.7rem; }
.art-preview img { width: 100%; height: 100%; object-fit: cover; }
.art-side { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; min-width: 0; }
.art-side .busy { opacity: 0.5; pointer-events: none; }
.file { font-size: 0.68rem; line-height: 1.4; }

.seg { display: flex; padding: 4px; border-radius: 100px; background: var(--surface); border: 1px solid var(--line); }
.seg label { flex: 1; }
.seg input { display: none; }
.seg span { display: flex; justify-content: center; padding: 11px 10px; border-radius: 100px; font-size: 0.64rem; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 800; color: var(--fg-faint); cursor: pointer; transition: all 0.25s; }
.seg input:checked + span { background: var(--primary-bg); color: var(--primary-fg); }

.palette { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); font-size: 0.72rem; font-weight: 600; }
.swatch { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }

.paste { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.paste textarea { resize: vertical; min-height: 56px; }
.link-row { display: flex; align-items: flex-end; gap: 10px; }
.link-ico { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; margin-bottom: 1px; border-radius: 10px; background: var(--surface); }
.link-ico svg { width: 18px; height: 18px; }
.link-field { flex: 1; min-width: 0; }
.link-row .icon-btn { margin-bottom: 1px; }
.tag { padding: 2px 8px; border-radius: 100px; font-size: 0.52rem; letter-spacing: 1px; font-weight: 800; }
.tag.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }

.perf { margin: 0; font-size: 0.85rem; font-weight: 700; color: var(--fg); }
.perf-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 0.78rem; color: var(--fg-dim); }
.perf-row strong { color: var(--fg); }

/* ---------- dialog ---------- */
.dialog { width: 100%; max-width: 380px; padding: 28px; background: var(--panel); }
.dialog-title { font-size: 2rem; color: var(--fg); margin-bottom: 8px; }
.dialog-msg { margin: 0 0 22px; font-size: 0.8rem; line-height: 1.5; color: var(--fg-dim); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }

.toast-enter-active, .toast-leave-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 16px); }

@media (max-width: 768px) {
  .admin { --pad: 16px; }
  .nav-tag { display: none; }
  .search { max-width: none; flex: 1 1 100%; }
  .grid { grid-template-columns: repeat(2, 1fr); gap: 26px 14px; }
  .rel-title { font-size: 1.3rem; }
  .drawer { max-width: 100%; border-radius: 0; border-left: none; }
  .drawer-head, .drawer-body, .drawer-foot { padding-left: 18px; padding-right: 18px; }
  .grid-2 { grid-template-columns: 1fr; }
  .art { flex-direction: column; align-items: flex-start; }
}
</style>