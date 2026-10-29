/* ------------------------------------------------------------------
   card.js — the altar card itself.

   Rendered as inline SVG so that what you see in the page is byte-for-
   byte the thing you export. No html2canvas, no screenshot service,
   no font that has to be fetched.
   ------------------------------------------------------------------ */

const W = 1000;
const H = 1400;

const C = {
  marigold: '#f2a13c',
  hot: '#ffbe6b',
  deep: '#c9761c',
  cream: '#f6e8d2',
  dim: '#c8b39a',
  magenta: '#c2185b',
  night: '#0d0913',
  night2: '#1b1229',
};

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isCJK = (ch) => /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(ch);

/* --- text measurement ------------------------------------------------ */
let _ctx;
function measureCtx() {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  return _ctx;
}

function tokenize(text) {
  const out = [];
  const re = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]|[^\s\u3000-\u303f\u3400-\u9fff\uff00-\uffef]+|\s+/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

function wrap(text, font, maxWidth) {
  const ctx = measureCtx();
  ctx.font = font;
  const lines = [];
  let line = '';
  for (const tok of tokenize(text)) {
    if (/^\s+$/.test(tok)) {
      if (line && !line.endsWith(' ')) line += ' ';
      continue;
    }
    const candidate = line + tok;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line.replace(/\s+$/, ''));
      line = tok;
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ''));
  return lines;
}

/* --- decorative pieces ---------------------------------------------- */
function papelPicado(y) {
  let cut = '';
  const n = 14;
  const w = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * w;
    cut += `<path d="M${x} ${y} q ${w / 2} ${w * 0.72} ${w} 0" fill="none" stroke="${C.night}" stroke-width="5"/>`;
    cut += `<circle cx="${x + w / 2}" cy="${y + w * 0.30}" r="7" fill="${C.night}"/>`;
    cut += `<path d="M${x + w / 2} ${y + w * 0.42} l -8 12 h 16 z" fill="${C.night}"/>`;
  }
  return `<g opacity="0.95">
    <rect x="0" y="${y}" width="${W}" height="46" fill="${C.magenta}"/>
    ${cut}
    <rect x="0" y="${y + 46}" width="${W}" height="3" fill="${C.deep}" opacity="0.5"/>
  </g>`;
}

function marigold(rawX, rawY, rawR, op = 1) {
  const cx = Number(rawX);
  const cy = Number(rawY);
  const r = Number(rawR);
  let petals = '';
  const count = 8;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    petals += `<circle cx="${(cx + Math.cos(a) * r * 0.62).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.62).toFixed(1)}" r="${(r * 0.46).toFixed(1)}" fill="${C.hot}" opacity="0.55"/>`;
  }
  return `<g opacity="${op}">
    ${petals}
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="${C.marigold}" opacity="0.85"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${C.deep}" opacity="0.75"/>
  </g>`;
}

function arch() {
  const cx = W / 2;
  const cy = 470;
  const rx = 372;
  const ry = 322;
  const start = Math.PI * 1.06;
  const end = Math.PI * 1.94;
  let flowers = '';
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + (end - start) * t;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    // fade the flowers toward the bottom so the arch dissolves into the page
    const op = 0.42 + Math.sin(t * Math.PI) * 0.58;
    const r = 13 + Math.sin(t * Math.PI) * 7;
    flowers += marigold(x.toFixed(1), y.toFixed(1), r.toFixed(1), op.toFixed(2));
  }
  // a hairline holds the flowers together instead of letting them scatter
  const arc = `M ${(cx + Math.cos(start) * rx).toFixed(1)} ${(cy + Math.sin(start) * ry).toFixed(1)} ` +
    `A ${rx} ${ry} 0 0 1 ${(cx + Math.cos(end) * rx).toFixed(1)} ${(cy + Math.sin(end) * ry).toFixed(1)}`;
  return `<g>
    <path d="${arc}" fill="none" stroke="${C.deep}" stroke-opacity="0.28" stroke-width="1.2"/>
    ${flowers}
  </g>`;
}

function candle(x, y, h = 118, w = 34) {
  return `<g>
    <defs>
      <radialGradient id="flame-${x}" cx="50%" cy="65%" r="60%">
        <stop offset="0%" stop-color="#fff3c4"/>
        <stop offset="45%" stop-color="${C.hot}"/>
        <stop offset="100%" stop-color="${C.deep}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="halo-${x}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${C.hot}" stop-opacity="0.13"/>
        <stop offset="40%" stop-color="${C.deep}" stop-opacity="0.05"/>
        <stop offset="72%" stop-color="${C.deep}" stop-opacity="0.015"/>
        <stop offset="100%" stop-color="${C.deep}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="wax-${x}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#d9c6a8"/>
        <stop offset="42%" stop-color="${C.cream}"/>
        <stop offset="100%" stop-color="#b9a486"/>
      </linearGradient>
    </defs>
    <circle cx="${x}" cy="${y - h * 0.55}" r="126" fill="url(#halo-${x})"/>
    <rect x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}" rx="5" fill="url(#wax-${x})" opacity="0.92"/>
    <rect x="${x - w / 2 + 3}" y="${y - h + 8}" width="${w * 0.22}" height="${h - 18}" rx="3" fill="#ffffff" opacity="0.22"/>
    <path d="M${x} ${y - h - 30} c 13 14 15 25 8 33 -6 7 -16 7 -21 0 -7 -9 -4 -20 13 -33 z" fill="url(#flame-${x})"/>
    <path d="M${x} ${y - h - 22} c 7 9 8 16 4 21 -4 5 -11 5 -14 0 -4 -6 -1 -13 10 -21 z" fill="#fff6d8"/>
    <rect x="${x - w / 2 - 3}" y="${y - 6}" width="${w + 6}" height="8" rx="4" fill="${C.deep}" opacity="0.85"/>
  </g>`;
}

/* --- the card -------------------------------------------------------- */
export function buildCardSVG(d) {
  const fontStack = `Georgia, 'Iowan Old Style', 'Songti SC', 'Noto Serif SC', serif`;
  const bodyMax = 706;
  const bodyX = (W - bodyMax) / 2 << 0;
  const bodyTop = 566;
  const bodyBottom = 1112;

  // shrink the body until it fits between the rule and the candles
  let fontSize = 27;
  let lineHeight = 45;
  let lines = [];
  const paragraphs = String(d.body || '').split(/\n\s*\n/).filter(Boolean);
  for (const size of [27, 26, 25, 24, 22, 20, 18, 16]) {
    const lh = Math.round(size * 1.68);
    const font = `${size}px ${fontStack}`;
    const wrapped = [];
    paragraphs.forEach((p, i) => {
      if (i > 0) wrapped.push('');
      wrapped.push(...wrap(p, font, bodyMax));
    });
    const needed = wrapped.length * lh;
    if (needed <= bodyBottom - bodyTop || size === 16) {
      fontSize = size; lineHeight = lh; lines = wrapped; break;
    }
  }

  // centre the block between the rule and the candles so short cards don't
  // leave a hole in the middle of the page
  const need = lines.length * lineHeight;
  const startY = bodyTop + Math.max(0, (bodyBottom - bodyTop - need) / 2) + lineHeight * 0.72;

  const bodyTspans = lines
    .map((ln, i) => `<tspan x="${bodyX}" y="${(startY + i * lineHeight).toFixed(1)}">${esc(ln) || ' '}</tspan>`)
    .join('');

  const nameSize = d.name && d.name.length > 18 ? 52 : 68;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Remembrance card for ${esc(d.name || 'someone')}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.night2}"/>
      <stop offset="55%" stop-color="${C.night}"/>
      <stop offset="100%" stop-color="#080510"/>
    </linearGradient>
    <radialGradient id="warm" cx="50%" cy="8%" r="70%">
      <stop offset="0%" stop-color="${C.marigold}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${C.marigold}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${C.deep}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${C.deep}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>

  ${papelPicado(0)}
  ${arch()}

  <g text-anchor="middle">
    <text x="${W / 2}" y="330" font-family="${fontStack}" font-size="19"
          letter-spacing="8" fill="${C.deep}" text-transform="uppercase">${esc((d.title || 'In memory').toUpperCase())}</text>

    <text x="${W / 2}" y="${412}" font-family="${fontStack}" font-size="${nameSize}"
          fill="${C.cream}" letter-spacing="1">${esc(d.name || '—')}</text>

    ${d.dates ? `<text x="${W / 2}" y="462" font-family="${fontStack}" font-size="22"
          letter-spacing="3" fill="${C.dim}">${esc(d.dates)}</text>` : ''}
  </g>

  <line x1="${W / 2 - 90}" y1="510" x2="${W / 2 + 90}" y2="510" stroke="${C.marigold}" stroke-opacity="0.55" stroke-width="1.4"/>
  ${marigold(W / 2, 510, 13, 0.9)}

  <g text-anchor="start">
    <text font-family="${fontStack}" font-size="${fontSize}" fill="${C.cream}" fill-opacity="0.93"
          style="white-space:pre">${bodyTspans}</text>
  </g>

  ${candle(198, 1300, 128, 32)}
  ${candle(802, 1300, 128, 32)}

  <g text-anchor="middle">
    <text x="${W / 2}" y="1282" font-family="${fontStack}" font-size="15"
          letter-spacing="2.4" fill="${C.dim}" fill-opacity="0.75">${esc(d.footer || '')}</text>
    <text x="${W / 2}" y="1330" font-family="${fontStack}" font-size="12.5"
          letter-spacing="3.6" fill="${C.deep}" fill-opacity="0.8">TRANSCRIBED ON THIS DEVICE · NEVER UPLOADED</text>
  </g>
</svg>`;
}

/* --- export ---------------------------------------------------------- */
export async function svgToPngBlob(svgString, scale = 2) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG could not be rasterised'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = C.night;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob(r, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
