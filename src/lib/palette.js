// Cover → page colour helpers shared by Release, Callback and Admin.

export const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

export const hslToHex = (h, s, l) => {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

// Most "present AND colourful" colour of the cover (not just the most frequent,
// which on most covers is black / white / grey).
export const dominantHsl = (img) => {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data // throws if the canvas is tainted

  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b
    buckets.set(key, e)
  }

  let best = null
  let bestScore = -1
  for (const e of buckets.values()) {
    const { s, l } = rgbToHsl(e.r / e.n, e.g / e.n, e.b / e.n)
    
    // Expand the penalty range to catch dark greys, and severely drop their multiplier
    const extremePenalty = l < 0.15 || l > 0.85 ? 0.05 : 1
    
    // Quadratically weight saturation so true colors easily beat massive areas of tinted grey
    const score = e.n * (Math.pow(s, 2) + 0.01) * extremePenalty
    
    if (score > bestScore) { bestScore = score; best = e }
  }
  if (!best) return { h: 0, s: 0 }
  const { h, s } = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n)
  return { h, s }
}

export const buildPalette = ({ h, s }, dark) => {
  const sat = s * 100
  // Bumped neutral threshold from 8 to 15 to prevent artifact hues from becoming vibrant accents
  const neutral = sat < 15
  return {
    bg: dark
      ? hslToHex(h, neutral ? 0 : Math.min(sat, 60) * 0.7, 10)
      : hslToHex(h, neutral ? 0 : Math.min(sat, 70) * 0.6, 93),
    accent: hslToHex(h, neutral ? 0 : Math.min(Math.max(sat, 45), 85), dark ? 68 : 36)
  }
}

// Rejects when the image can't be loaded or read (usually: host without CORS headers).
export const loadPalette = (url, dark) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try { resolve(buildPalette(dominantHsl(img), dark)) } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('Image failed to load (CORS?)'))
    img.src = url
  })