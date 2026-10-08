<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '../supabase'
import { PLATFORMS, PRESAVE, SOCIALS, followInfo } from '../lib/platforms'
import { releaseTime, formatLong } from '../lib/releaseDate'
import { trackView, trackClick } from '../lib/track'
import { usePageTheme } from '../composables/usePageTheme'
import logoUrl from '../assets/gato_logo.png'

const route = useRoute()
const releaseId = route.params.id

const release = ref(null)
const links = ref(null)
const isLoading = ref(true)
const isReleased = ref(false)
const copied = ref(false)

const { rootVars, apply } = usePageTheme()

/* ---------------- Countdown (to 00:00 Swiss time) ---------------- */
const time = ref({ days: '00', hours: '00', minutes: '00', seconds: '00' })
const countdownUnits = [
  { key: 'days', label: 'DAYS' },
  { key: 'hours', label: 'HRS' },
  { key: 'minutes', label: 'MIN' },
  { key: 'seconds', label: 'SEC' }
]
const pad = (n) => String(n).padStart(2, '0')
let timer = null
let releaseAt = null

const tick = () => {
  const diff = releaseAt - Date.now()
  if (diff <= 0) {
    isReleased.value = true
    clearInterval(timer)
    return
  }
  const s = Math.floor(diff / 1000)
  time.value = {
    days: pad(Math.floor(s / 86400)),
    hours: pad(Math.floor((s % 86400) / 3600)),
    minutes: pad(Math.floor((s % 3600) / 60)),
    seconds: pad(s % 60)
  }
}

/* ---------------- Buttons ---------------- */
const platforms = computed(() => {
  const l = links.value || {}
  if (isReleased.value) {
    return PLATFORMS.filter((p) => l[p.column]).map((p) => ({
      id: p.id, key: p.id, track: p.id, url: l[p.column], label: p.cta || p.label
    }))
  }
  return PRESAVE.filter((p) => l[p.column]).map((p) => ({
    id: p.id, key: `pre-${p.id}`, track: `presave-${p.id}`, url: l[p.column], label: p.cta
  }))
})

// Always-visible Follow button, built from the artist link set in the admin
const follow = computed(() => followInfo(links.value?.artist_url))

// Instagram / TikTok profile buttons, shown at the bottom before release day
const socials = computed(() => {
  const l = links.value || {}
  return SOCIALS.filter((s) => l[s.column]).map((s) => ({
    id: s.id, key: s.id, track: `social-${s.id}`, url: l[s.column], label: s.label
  }))
})

const btnAttrs = (p) => ({
  href: p.url,
  target: '_blank',
  rel: 'noopener noreferrer',
  onClick: () => trackClick(release.value.id, p.track)
})

/* ---------------- Share ---------------- */
const share = async () => {
  const url = window.location.href
  trackClick(release.value.id, 'share')
  try {
    if (navigator.share) {
      await navigator.share({ title: `${release.value.title} — ${release.value.artist}`, url })
      return
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
  }
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch { /* ignore */ }
}

/* ---------------- Lifecycle ---------------- */
onMounted(async () => {
  const [{ data: releaseData }, { data: linksData }] = await Promise.all([
    supabase.from('releases').select('*').eq('id', releaseId).maybeSingle(),
    supabase.from('links').select('*').eq('release_id', releaseId).maybeSingle()
  ])

  if (releaseData) {
    release.value = releaseData
    links.value = linksData
    document.title = `${releaseData.artist} - ${releaseData.title} | fm GATO`
    apply(releaseData.cover_url, releaseData.theme)
    trackView(releaseData.id)

    releaseAt = releaseTime(releaseData.release_date)
    if (releaseAt === null) {
      isReleased.value = true
    } else {
      tick()
      if (!isReleased.value) timer = setInterval(tick, 1000)
    }
  } else {
    document.title = 'Not Found | fm GATO'
    apply(null, 'dark')
  }
  isLoading.value = false
})

watch(() => release.value?.theme, (newTheme) => {
  if (release.value) apply(release.value.cover_url, newTheme)
})

onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div
    v-if="!isLoading && release"
    class="g-page release-viewport"
    :class="`theme-${release.theme === 'light' ? 'light' : 'dark'}`"
    :style="rootVars"
  >
    <div class="g-stage" aria-hidden="true">
      <div
        class="g-stage-img"
        :class="{ 'is-blurred': release.use_blur !== false }"
        :style="{ backgroundImage: `url(${release.cover_url || ''})` }"
      ></div>
    </div>

    <div class="content-layer">
      <div class="g-card minimal-card">
        <div class="artwork-container">
          <img
            :src="release.cover_url"
            :alt="release.title"
            class="artwork-img soft-hover"
            crossorigin="anonymous"
            fetchpriority="high"
            decoding="async"
          />
          <button type="button" class="share-btn" :aria-label="copied ? 'Link copied' : 'Share'" @click="share">
            <svg v-if="!copied" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </button>
        </div>

        <div class="metadata">
          <h1 class="title-serif track-title">{{ release.title }}</h1>
          <h2 class="track-artist">{{ release.artist }}</h2>
          <div v-if="release.release_date" class="date-badge">
            <span>{{ formatLong(release.release_date) }}</span>
          </div>
        </div>

        <div class="divider"></div>

        <template v-if="!isReleased">
          <div class="countdown-minimal">
            <div v-for="u in countdownUnits" :key="u.key" class="time-unit">
              <span class="title-serif time-num">{{ time[u.key] }}</span>
              <span class="time-label">{{ u.label }}</span>
            </div>
          </div>
          <p class="release-note">Releases at 00:00</p>
        </template>

        <div v-if="follow" class="follow-wrap">
          <a
            :href="follow.url"
            target="_blank"
            rel="noopener noreferrer"
            class="follow-btn"
            @click="trackClick(release.id, 'follow')"
          >
            <img class="follow-icon" :src="`/icons/spotify.png`" alt="" aria-hidden="true" />
            <span>{{ follow.label }}</span>
          </a>
        </div>

        <div class="actions-grid">
          <a
            v-for="p in platforms"
            :key="p.key"
            v-bind="btnAttrs(p)"
            class="btn-platform"
          >
            <img class="platform-icon" :src="`/icons/${p.id}.png`" alt="" aria-hidden="true" />
            <span>{{ p.label }}</span>
          </a>
        </div>

        <!-- Instagram / TikTok: pre-release page only -->
        <div v-if="socials.length" class="socials-wrap">
          <div class="socials">
            <a
              v-for="p in socials"
              :key="p.key"
              v-bind="btnAttrs(p)"
              class="btn-platform social-btn"
            >
              <img class="platform-icon" :src="`/icons/${p.id}.png`" alt="" aria-hidden="true" />
              <span>{{ p.label }}</span>
            </a>
          </div>
        </div>
      </div>

      <footer class="common-footer">
        <div class="powered-by">
          <span class="powered-text">BUILT WITH</span>
          <span class="fm-logo"><span class="fm-prefix">fm</span>GATO</span>
        </div>
        <a href="https://gatomusic.ch" target="_blank" rel="noopener noreferrer" class="site-link">gatomusic.ch</a>
      </footer>
    </div>
  </div>

  <div v-else-if="isLoading" class="loading-state">
    <img :src="logoUrl" alt="GATO" class="logo-img-large pulse" />
  </div>

  <div v-else class="g-page release-viewport theme-dark" :style="rootVars">
    <div class="g-stage" aria-hidden="true"></div>
    <div class="content-layer">
      <div class="g-card minimal-card">
        <h1 class="title-serif track-title">NOT FOUND.</h1>
        <p class="error-text">This link isn't valid.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-state { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; z-index: 100000; background-color: var(--gato-cream, #f2efe9); }
.logo-img-large { width: 120px; height: auto; }
.pulse { animation: g-pulse 1.5s infinite alternate; }

.release-viewport {
  display: flex; flex-direction: column; align-items: center;
  padding: calc(env(safe-area-inset-top, 0px) + 32px) 20px calc(env(safe-area-inset-bottom, 0px) + 48px);
}
.content-layer {
  position: relative; z-index: 1; width: 100%; max-width: 400px; margin: auto;
  display: flex; flex-direction: column; align-items: center;
  animation: g-fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

/* ---------- Card ---------- */
.minimal-card { width: 100%; padding: 32px 28px; text-align: center; }
.artwork-container { position: relative; margin-bottom: 22px; }
.artwork-img {
  display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 14px;
  box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.4);
}
.soft-hover { transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
@media (hover: hover) and (pointer: fine) {
  .soft-hover:hover { transform: scale(1.015); box-shadow: 0 18px 36px -18px rgba(0, 0, 0, 0.42); }
}

.share-btn {
  position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; padding: 0;
  display: grid; place-items: center; border-radius: 50%; cursor: pointer;
  color: #fff; background: rgba(0, 0, 0, 0.38); border: 1px solid rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  -webkit-tap-highlight-color: transparent; transition: background 0.2s, transform 0.2s;
}
.share-btn svg { width: 17px; height: 17px; }
.share-btn:active { transform: scale(0.92); }
@media (hover: hover) and (pointer: fine) { .share-btn:hover { background: rgba(0, 0, 0, 0.55); } }

/* ---------- Text ---------- */
.metadata { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 20px; }
.track-title { font-size: 2.8rem; line-height: 0.95; margin: 0 0 4px; color: var(--fg); overflow-wrap: anywhere; }
.track-artist { margin: 0; font-family: var(--font-ui); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 2.5px; color: var(--fg-dim); }
.date-badge {
  display: inline-flex; align-items: center; margin-top: 12px; padding: 5px 14px; border-radius: 50px;
  font-family: var(--font-ui); font-size: 0.72rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
  background: var(--badge-bg); color: var(--fg);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}
.divider { width: 36px; height: 2px; margin: 20px auto; border-radius: 2px; background: var(--accent); opacity: 0.5; }

.countdown-minimal { display: flex; justify-content: center; align-items: center; gap: 16px; }
.time-unit { display: flex; flex-direction: column; align-items: center; min-width: 44px; }
.time-num { font-size: 2.1rem; line-height: 1; color: var(--fg); font-variant-numeric: tabular-nums; }
.time-label { margin-top: 6px; font-size: 0.55rem; font-weight: bold; letter-spacing: 2px; color: var(--fg-faint); }
.release-note { margin: 14px 0 26px; font-size: 0.58rem; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: var(--fg-faint); }

/* ---------- Platform buttons (Classic Setup) ---------- */
.actions-grid { display: flex; flex-direction: column; gap: 10px; }

.btn-platform {
  width: 100%; box-sizing: border-box; padding: 16px 20px; border-radius: 100px;
  display: flex; align-items: center; justify-content: flex-start; gap: 14px;
  font-family: var(--font-ui); font-weight: bold; font-size: 0.72rem;
  text-transform: uppercase; letter-spacing: 1.5px; text-decoration: none;
  cursor: pointer; -webkit-appearance: none; appearance: none;
  background: var(--btn-bg); color: var(--fg); border: 1px solid var(--btn-border);
  transition: background 0.25s ease, border-color 0.25s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.25s ease;
  -webkit-tap-highlight-color: transparent;
}

/* We use object-fit to ensure 512x512 images scale perfectly without stretching */
.platform-icon { width: 18px; height: 18px; flex-shrink: 0; object-fit: contain; border-radius: 4px; }

/* Desktop hover: Classic highlight */
@media (hover: hover) and (pointer: fine) {
  .btn-platform:hover {
    background: var(--surface-hover); 
    border-color: var(--fg-dim);
    transform: translateY(-1px);
    box-shadow: 0 8px 18px -14px rgba(0, 0, 0, 0.3);
  }
}

/* Touch: Gentle press tint */
.btn-platform:active {
  background: var(--surface);
  transform: scale(0.985);
}

/* ---------- Follow (always on top) ---------- */
.follow-wrap { margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.follow-btn {
  width: 100%; box-sizing: border-box; padding: 16px 20px; border-radius: 100px;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  font-family: var(--font-ui); font-weight: bold; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1.5px; text-decoration: none;
  background: var(--primary-bg); color: var(--primary-fg); border: 1px solid transparent;
  transition: opacity 0.2s, transform 0.2s; -webkit-tap-highlight-color: transparent;
}
.follow-icon { width: 16px; height: 16px; flex-shrink: 0; object-fit: contain; opacity: 0.9; }
@media (hover: hover) and (pointer: fine) { .follow-btn:hover { opacity: 0.88; transform: translateY(-1px); } }
.follow-btn:active { transform: scale(0.985); opacity: 0.9; }

/* ---------- Socials (pre-release, bottom of card) ---------- */
.socials-wrap { margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--line); }
.socials { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 10px; }
.social-btn { justify-content: center; padding: 14px 12px; }

/* ---------- Footer ---------- */
.common-footer { margin-top: 32px; display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; color: var(--fg-dim); }
.powered-by { display: flex; align-items: center; justify-content: center; gap: 10px; }
.powered-text { font-size: 0.7rem; letter-spacing: 2px; font-weight: bold; opacity: 0.7; }
.powered-by .fm-logo { font-size: 1.6rem; }
.site-link { font-size: 0.65rem; letter-spacing: 1.5px; text-decoration: none; text-transform: uppercase; font-weight: bold; color: var(--fg-dim); opacity: 0.7; transition: opacity 0.3s; }
.site-link:hover { opacity: 1; }
.error-text { margin: 12px 0 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--fg-dim); }

@media (max-width: 480px) {
  .minimal-card { padding: 26px 20px; border-radius: 26px; }
  .track-title { font-size: 2.5rem; }
  .time-num { font-size: 1.9rem; }
  .countdown-minimal { gap: 10px; }
}
</style>