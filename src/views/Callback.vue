<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { formatLong } from '../lib/releaseDate'
import { usePageTheme } from '../composables/usePageTheme'

const route = useRoute()
const router = useRouter()

const status = ref('loading') // 'loading' | 'success' | 'error'
const message = ref('Connecting to Spotify…')
const releaseId = ref(null)
const release = ref(null)

const { rootVars, apply } = usePageTheme()

onMounted(async () => {
  document.title = 'Pre-save | fm GATO'

  const { code, state, error } = route.query
  // The one-time code must not stay in the address bar / history.
  window.history.replaceState(window.history.state, '', route.path)

  if (state) {
    releaseId.value = state
    // Load the release in the background so the page can use its cover + theme.
    supabase
      .from('releases')
      .select('id,title,artist,cover_url,theme,release_date')
      .eq('id', state)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        release.value = data
        apply(data.cover_url, data.theme)
      })
  } else {
    apply(null, 'dark')
  }

  if (error) return fail('Spotify connection was cancelled.')
  if (!code) return fail('Invalid redirection.')

  // Spotify codes are single-use: a refresh / back-navigation must not call the function again.
  const doneKey = `gato:presave:${code}`
  try {
    if (sessionStorage.getItem(doneKey)) {
      status.value = 'success'
      message.value = 'Pre-save confirmed.'
      return
    }
  } catch { /* private mode */ }

  message.value = 'Saving your pre-save…'
  try {
    const { data, error: fnError } = await supabase.functions.invoke('spotify-auth', {
      body: { code, releaseId: state }
    })
    if (fnError) throw new Error(fnError.message)
    if (data?.error) throw new Error(data.error)

    status.value = 'success'
    message.value = data?.message || 'Pre-save confirmed.'
    try { sessionStorage.setItem(doneKey, '1') } catch { /* ignore */ }
  } catch (err) {
    console.error(err)
    fail('Something went wrong. Please try again.')
  }
})

function fail(msg) {
  status.value = 'error'
  message.value = msg
}

const goBack = () => router.push(releaseId.value ? `/${releaseId.value}` : '/')
</script>

<template>
  <div class="g-page callback-viewport" :class="`theme-${release?.theme === 'light' ? 'light' : 'dark'}`" :style="rootVars">
    <div class="g-stage" aria-hidden="true">
      <div
        v-if="release?.cover_url"
        class="g-stage-img is-blurred"
        :style="{ backgroundImage: `url(${release.cover_url})` }"
      ></div>
    </div>

    <div class="content-layer">
      <div class="g-card status-card">
        <div v-if="release?.cover_url" class="cover-wrap">
          <img :src="release.cover_url" :alt="release.title" class="cover" crossorigin="anonymous" />
          <span v-if="status !== 'loading'" class="cover-badge" :class="status" aria-hidden="true">
            <svg v-if="status === 'success'" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            <svg v-else viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
          </span>
        </div>
        <div v-else class="icon-ring" :class="status" aria-hidden="true">
          <span v-if="status === 'loading'" class="spinner"></span>
          <svg v-else-if="status === 'success'" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          <svg v-else viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
        </div>

        <h1 class="title-serif status-title">
          <template v-if="status === 'loading'">Processing…</template>
          <template v-else-if="status === 'success'">You're in.</template>
          <template v-else>Oops.</template>
        </h1>

        <p v-if="release" class="release-line">{{ release.title }} · {{ release.artist }}</p>
        <p class="status-desc">{{ message }}</p>

        <p v-if="status === 'success'" class="status-sub">
          It will be added to your Spotify library on release day<template v-if="release?.release_date"> ({{ formatLong(release.release_date) }})</template>.
        </p>

        <button v-if="status !== 'loading'" class="g-btn g-btn--block back-btn" :class="{ 'g-btn--primary': status === 'success' }" @click="goBack">
          Back to release
        </button>
      </div>

      <footer class="common-footer">
        <span class="powered-text">POWERED BY</span>
        <span class="fm-logo"><span class="fm-prefix">fm</span>GATO</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.callback-viewport {
  display: flex; align-items: center; justify-content: center;
  padding: calc(env(safe-area-inset-top, 0px) + 24px) 20px calc(env(safe-area-inset-bottom, 0px) + 32px);
}
.content-layer {
  position: relative; z-index: 1; width: 100%; max-width: 400px;
  display: flex; flex-direction: column; align-items: center;
  animation: g-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.status-card { width: 100%; padding: 32px 28px; text-align: center; display: flex; flex-direction: column; align-items: center; }

.cover-wrap { position: relative; width: 150px; margin-bottom: 8px; }
.cover { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 14px; box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.45); }
.cover-badge {
  position: absolute; right: -12px; bottom: -12px; width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center; color: #fff; border: 3px solid var(--page-bg);
}
.cover-badge svg { width: 20px; height: 20px; }
.cover-badge.success { background: #1a7f45; }
.cover-badge.error { background: #b42318; }

.icon-ring { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); background: var(--surface); }
.icon-ring svg { width: 28px; height: 28px; }
.icon-ring.success { color: var(--ok); }
.icon-ring.error { color: var(--danger); }
.spinner { width: 26px; height: 26px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--fg); animation: g-spin 0.9s linear infinite; }

.status-title { font-size: 3rem; line-height: 1; margin: 18px 0 6px; color: var(--fg); }
.release-line { margin: 0 0 10px; font-size: 0.7rem; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--fg-dim); }
.status-desc { margin: 0; font-size: 0.78rem; letter-spacing: 1.2px; font-weight: bold; text-transform: uppercase; color: var(--fg); }
.status-sub { margin: 10px 0 0; font-size: 0.72rem; line-height: 1.5; color: var(--fg-dim); }
.back-btn { margin-top: 24px; padding: 16px 20px; }

.common-footer { margin-top: 28px; display: flex; align-items: center; gap: 10px; color: var(--fg-dim); }
.powered-text { font-size: 0.7rem; letter-spacing: 2px; font-weight: bold; opacity: 0.7; }
.common-footer .fm-logo { font-size: 1.5rem; }
</style>
