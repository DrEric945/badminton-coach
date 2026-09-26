// 介面工具：建立元素、提示訊息、畫骨架、畫折線圖
export const $ = (s, r = document) => r.querySelector(s);

const PROPS = new Set(['value', 'checked', 'disabled', 'muted', 'playsInline', 'loop', 'autoplay', 'selected', 'hidden', 'controls', 'srcObject', 'min', 'max', 'step', 'type']);
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (PROPS.has(k)) { el[k] = v; if (k === 'muted' || k === 'playsInline') el.setAttribute(k === 'muted' ? 'muted' : 'playsinline', ''); }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let toastTimer = null;
export function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  return { ctx, W, H, dpr };
}

// 影片以 object-fit: contain 顯示時，把正規化座標換成畫布座標
export function containMap(vw, vh, W, H) {
  if (!vw || !vh) return (x, y) => [x * W, y * H];
  const s = Math.min(W / vw, H / vh);
  const dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  const fn = (x, y) => [ox + x * dw, oy + y * dh];
  fn.inverse = (px, py) => [(px - ox) / dw, (py - oy) / dh];
  return fn;
}

export const POSE_EDGES = [[11, 12], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];
const DOM_R = new Set(['12-14', '14-16', '16-20']);
const DOM_L = new Set(['11-13', '13-15', '15-19']);
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function drawPose(ctx, arr, map, { color = '#F4F6F1', accent = null, hand = 'R', lw = 3, alpha = 1, head = true } = {}) {
  if (!arr) return;
  const P = (k) => map(arr[3 * k], arr[3 * k + 1]);
  const vis = (k) => arr[3 * k + 2];
  const dom = hand === 'L' ? DOM_L : DOM_R;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of POSE_EDGES) {
    if (vis(a) < 0.3 || vis(b) < 0.3) continue;
    const isDom = dom.has(a + '-' + b);
    ctx.strokeStyle = accent && isDom ? accent : color;
    ctx.lineWidth = isDom ? lw * 1.4 : lw;
    const [x1, y1] = P(a), [x2, y2] = P(b);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const k of JOINTS) {
    if (vis(k) < 0.3) continue;
    const [x, y] = P(k);
    ctx.beginPath(); ctx.arc(x, y, lw * 0.95, 0, Math.PI * 2); ctx.fill();
  }
  if (head && vis(0) > 0.3) {
    const [nx, ny] = P(0), [lx, ly] = P(11), [rx, ry] = P(12);
    const r = Math.max(lw * 2, Math.hypot(lx - rx, ly - ry) * 0.3);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(nx, ny, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export const HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export function drawHand(ctx, arr, map, { color = '#F4F6F1', thumb = null, lw = 3, alpha = 1 } = {}) {
  if (!arr) return;
  const P = (k) => map(arr[3 * k], arr[3 * k + 1]);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (const [a, b] of HAND_EDGES) {
    ctx.strokeStyle = thumb && b <= 4 && a <= 4 ? thumb : color;
    ctx.lineWidth = lw;
    const [x1, y1] = P(a), [x2, y2] = P(b);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = color;
  for (let k = 0; k < 21; k++) { const [x, y] = P(k); ctx.beginPath(); ctx.arc(x, y, lw * 0.9, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 簡單折線圖：series = [{ data, color, label }]，x 軸以索引等距排列
export function lineChart(canvas, { series, markers = [], cursor = null, unit = '°' }) {
  const { ctx, W, H, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 40 * dpr, r: 10 * dpr, t: 12 * dpr, b: 22 * dpr };
  const all = series.flatMap((s) => s.data).filter((v) => isFinite(v));
  if (!all.length) return;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 10) { const c = (hi + lo) / 2; lo = c - 5; hi = c + 5; }
  const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const n = Math.max(...series.map((s) => s.data.length));
  const X = (k) => pad.l + (k / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ink = cssVar('--muted') || '#5B6873';
  ctx.font = `${11 * dpr}px ${cssVar('--font-num') || 'sans-serif'}`;
  ctx.fillStyle = ink; ctx.strokeStyle = cssVar('--rule') || '#ccd'; ctx.lineWidth = dpr;
  for (let g = 0; g <= 3; g++) {
    const v = lo + ((hi - lo) * g) / 3, y = Y(v);
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(v) + unit, pad.l - 6 * dpr, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const m of markers) {
    const x = X(m.x);
    ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText(m.label, Math.min(W - 30 * dpr, Math.max(pad.l + 20 * dpr, x)), H - pad.b + 5 * dpr);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.2 * dpr; ctx.lineJoin = 'round';
    ctx.beginPath();
    s.data.forEach((v, k) => (k ? ctx.lineTo(X(k), Y(v)) : ctx.moveTo(X(k), Y(v))));
    ctx.stroke();
  }
  if (cursor != null) {
    ctx.strokeStyle = cssVar('--ink') || '#000'; ctx.lineWidth = 1.5 * dpr;
    const x = X(cursor); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
  }
}

export function segmented(options, current, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const btns = options.map(([value, text]) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(value === current), onclick: () => {
      btns.forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onChange(value);
    } }, text);
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function groupField(label, control) {
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files && input.files[0]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function fmtScore(x) { return Math.round(Math.max(0, Math.min(100, x))); }
