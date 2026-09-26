/* Premium generated product art per category.
   Each product gets a polished illustrated bottle/can/box instead of a
   low-quality photo. Deterministic per product id so the art is stable. */

const palettes: Record<string, { a: string; b: string; accent: string; label: string }> = {
  energy_drinks: { a: '#2f3d8f', b: '#151a3d', accent: '#8fd0ff', label: 'ENERGY' },
  fresh_drinks: { a: '#1f9d6c', b: '#0c4a34', accent: '#b8f0d4', label: 'FRESH' },
  protein_snacks: { a: '#c2571f', b: '#6e2c0d', accent: '#ffd9a8', label: 'PROTEIN' },
  candies: { a: '#d9457c', b: '#7c1f4e', accent: '#ffd0e8', label: 'SWEETS' },
  snacks: { a: '#e49b52', b: '#8a4a1d', accent: '#ffe6bf', label: 'CRUNCH' },
  alcohol_cocktails: { a: '#8e2b47', b: '#3d0f24', accent: '#ffb3c8', label: 'SPIRITS' },
}

const fallback = { a: '#e49b52', b: '#8a4a1d', accent: '#ffe6bf', label: 'FUZZY' }

export function productArt(productName: string, category: string): string {
  const p = palettes[category] ?? fallback
  const name = productName.toUpperCase()
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.a}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${p.b}" stop-opacity="0.32"/>
    </linearGradient>
    <linearGradient id="can" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.b}"/>
      <stop offset="0.28" stop-color="${p.a}"/>
      <stop offset="0.55" stop-color="${p.accent}" stop-opacity="0.55"/>
      <stop offset="0.8" stop-color="${p.a}"/>
      <stop offset="1" stop-color="${p.b}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0" stop-color="${p.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="400" height="400" rx="28" fill="url(#bg)"/>
  <circle cx="200" cy="185" r="150" fill="url(#glow)"/>

  <!-- shadow -->
  <ellipse cx="200" cy="338" rx="92" ry="14" fill="#000" opacity="0.28"/>

  <!-- can / bottle body -->
  <g>
    <rect x="132" y="92" width="136" height="238" rx="26" fill="url(#can)"/>
    <rect x="132" y="92" width="136" height="30" rx="15" fill="#d8d8de"/>
    <rect x="132" y="92" width="136" height="10" rx="5" fill="#f4f4f6"/>
    <rect x="150" y="104" width="14" height="220" rx="7" fill="url(#shine)" opacity="0.5"/>
    <text x="200" y="205" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="44" fill="#ffffff" opacity="0.96" letter-spacing="2">${initials}</text>
    <text x="200" y="240" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="15" fill="${p.accent}" letter-spacing="4">${p.label}</text>
    <rect x="164" y="258" width="72" height="4" rx="2" fill="#ffffff" opacity="0.35"/>
    <text x="200" y="290" text-anchor="middle" font-family="Arial, sans-serif" font-weight="600" font-size="12" fill="#ffffff" opacity="0.65" letter-spacing="1">FUZZY STORE</text>
  </g>
</svg>`

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}
