import { onUnmounted } from 'vue'

// Paints html/body + <meta name="theme-color"> so Safari's top/bottom bars match the page,
// and restores everything when the view is left.
export function useSystemChrome() {
  let saved = null

  const meta = (name) => {
    let m = document.querySelector(`meta[name="${name}"]`)
    if (!m) {
      m = document.createElement('meta')
      m.name = name
      document.head.appendChild(m)
    }
    return m
  }

  const capture = () => {
    if (saved) return
    const vp = document.querySelector('meta[name="viewport"]')
    saved = {
      bodyBg: document.body.style.backgroundColor,
      htmlBg: document.documentElement.style.backgroundColor,
      margin: document.body.style.margin,
      theme: meta('theme-color').content,
      viewport: vp?.content
    }
    // Without viewport-fit=cover Safari paints its own bars instead of using the page colour.
    if (vp && !vp.content.includes('viewport-fit')) vp.content += ', viewport-fit=cover'
  }

  const set = (color) => {
    capture()
    document.body.style.margin = '0'
    document.body.style.backgroundColor = color
    document.documentElement.style.backgroundColor = color
    meta('theme-color').content = color
  }

  const restore = () => {
    if (!saved) return
    document.body.style.backgroundColor = saved.bodyBg
    document.documentElement.style.backgroundColor = saved.htmlBg
    document.body.style.margin = saved.margin
    meta('theme-color').content = saved.theme || '#f2efe9'
    const vp = document.querySelector('meta[name="viewport"]')
    if (vp && saved.viewport) vp.content = saved.viewport
    saved = null
  }

  onUnmounted(restore)
  return { set, restore }
}
