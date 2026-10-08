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
  // 1. Maintain aspect ratio to prevent distorting text/fine details
  const MAX_DIM = 150
  let width = img.width, height = img.height
  if (width > MAX_DIM || height > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
    width = Math.max(1, Math.round(width * ratio))
    height = Math.max(1, Math.round(height * ratio))
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  
  // 2. Disable smoothing: prevents vibrant text from blending into black backgrounds and becoming dull
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, width, height)
  
  const data = ctx.getImageData(0, 0, width, height).data

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
    
    // 3. Continuous Lightness Weight: Peaks between 0.15 and 0.85. 
    // Smoothly drops to exactly 0 for pure black or pure white.
    let lWeight = 1
    if (l < 0.15) lWeight = l / 0.15
    else if (l > 0.85) lWeight = (1 - l) / 0.15
    
    // 4. Score Formula:
    // - Math.pow(s, 3): Cubing saturation gives vibrant colors an insurmountable advantage.
    // - Math.pow(lWeight, 2): Squaring the lightness weight heavily punishes near-black artifact colors (like the invisible teal).
    const score = e.n * Math.pow(s, 3) * Math.pow(lWeight, 2)
    
    if (score > bestScore) { bestScore = score; best = e }
  }
  
  if (!best) return { h: 0, s: 0 }
  const { h, s } = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n)
  return { h, s }
}

export const buildPalette = ({ h, s }, dark) => {
  const sat = s * 100
  const neutral = sat < 10
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