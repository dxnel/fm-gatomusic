import { ref, computed } from 'vue'
import { buildPalette, loadPalette } from '../lib/palette'
import { useSystemChrome } from './useSystemChrome'

// Derives the page colour + accent from a cover, applies it to the Safari chrome,
// and exposes CSS variables for the root element (`:style="rootVars"`).
export function usePageTheme() {
  const chrome = useSystemChrome()
  const pageColor = ref('#0f0f0f')
  const accentColor = ref('#bdbdbd')
  let token = 0

  const commit = (palette, t) => {
    if (t !== token) return // a newer apply() superseded this one
    pageColor.value = palette.bg
    accentColor.value = palette.accent
    chrome.set(palette.bg)
  }

  const apply = async (coverUrl, theme) => {
    const dark = theme !== 'light'
    const t = ++token
    // Neutral colour immediately: no cream/white flash while the cover loads.
    commit(buildPalette({ h: 0, s: 0 }, dark), t)
    if (!coverUrl) return
    try {
      commit(await loadPalette(coverUrl, dark), t)
    } catch (e) {
      console.warn("Couldn't read cover colours (host needs CORS headers). Using neutral colours.", e)
    }
  }

  const rootVars = computed(() => ({ '--page-bg': pageColor.value, '--accent': accentColor.value }))

  return { pageColor, accentColor, rootVars, apply }
}
