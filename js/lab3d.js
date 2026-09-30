// 動作分析3D實驗室：3D 骨架檢視器
// 以 Canvas 2D 自行做透視投影與深度排序，不依賴外部 3D 函式庫：第一次使用不必額外下載，舊手機也跑得動。
// 座標：MediaPipe 世界座標（公尺，髖部為原點，y 向下、z 向鏡頭內）轉成 x 右、y 上、z 朝鏡頭。

const COLORS = { blue: '#4EA8FF', orange: '#FF8A3D', red: '#FF3B3B' };
const BG_TOP = '#0E1C2B', BG_BOTTOM = '#07111B';
const FOV = (40 * Math.PI) / 180;
// 33 = 肩膀中心、34 = 髖部中心、35 = 頭部中心（兩耳中點）
const BONES = [[11, 12], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [33, 35], [33, 34]];
const JOINTS = [11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 31, 32];
const FEET = [27, 28, 29, 30, 31, 32];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(clamp(c * k, 0, 255));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// 把一段骨架影格轉成 3D 點（含三個虛擬點），並做輕度時間平滑
export function prepSequence(frames, { mirror = false, scale = 1 } = {}) {
  const fx = mirror ? -1 : 1;
  const raw = frames.map((f) => {
    const P = [];
    for (let k = 0; k < 33; k++) P.push([f.w[3 * k] * fx * scale, -f.w[3 * k + 1] * scale, -f.w[3 * k + 2] * scale]);
    const mid = (a, b) => mul(add(P[a], P[b]), 0.5);
    const ears = mid(7, 8), sh = mid(11, 12);
    // 耳朵沒被偵測到時（座標接近原點或跑到肩膀以下），改用鼻子當頭部位置
    const head = ears[1] > sh[1] + 0.05 * scale ? ears : P[0];
    P.push(sh, mid(23, 24), head);
    return P;
  });
  const n = raw.length;
  const out = raw.map((_, i) => raw[i].map((_, k) => {
    let s = [0, 0, 0], c = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) { s = add(s, raw[j][k]); c++; }
    return mul(s, 1 / c);
  }));
  let floor = Infinity, top = -Infinity;
  for (const P of out) {
    for (const k of FEET) floor = Math.min(floor, P[k][1]);
    for (const q of P) top = Math.max(top, q[1]);
    top = Math.max(top, P[35][1] + 0.12 * scale);
  }
  return { pts: out, floor, top };
}

/**
 * 建立 3D 實驗室檢視器
 * opts.skeletons: [{ seq(prepSequence 結果), seqOverlay(重疊模式用，可省略), color: 'blue'|'orange', tag, index: 'i'|'j' }]
 * opts.steps: [[i, j], ...] 對齊後的時間軸；單一骨架時 j 為 null
 * opts.moments: [{ key, label, k }]
 * opts.phaseLabel(k)、opts.timeLabel(k)
 * opts.arcsFor(momentKey) => [{ part, values: [數值, 數值], joints: [{v,a,c}, {v,a,c}] }]
 * opts.stepSeconds：每一步的秒數（控制播放速度）
 * opts.facing：{ front, side } 兩個水平角度（弧度）
 * opts.onPos(k, playing)
 */
export function createLab(container, opts) {
  const single = opts.skeletons.length === 1;
  const canvas = h('canvas', { class: 'lab-canvas', 'aria-label': '3D 骨架，可拖曳旋轉、雙指或滾輪縮放' });
  const stage = h('div', { class: 'lab-stage' }, canvas);
  const caption = h('div', { class: 'lab-caption', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'play-btn', type: 'button', 'aria-label': '播放' });
  const slider = h('input', { type: 'range', min: 0, max: Math.max(0, opts.steps.length - 1), step: 1, value: 0, 'aria-label': '時間軸' });
  const marks = h('div', { class: 'lab-marks' });
  const timeEl = h('span', { class: 'lab-time' });
  const segBtns = (items, cur, onPick, label) => {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const bs = items.map(([v, t]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === cur) }, t);
      b.addEventListener('click', () => { bs.forEach((x) => x.setAttribute('aria-checked', String(x === b))); onPick(v); });
      return b;
    });
    wrap.append(...bs);
    return wrap;
  };
  const viewBtns = h('div', { class: 'lab-views' },
    ...[['front', '正面'], ['side', '側面'], ['top', '俯視']].map(([v, t]) => h('button', { class: 'btn secondary lab-view', type: 'button', onclick: () => setView(v) }, t)));
  const controls = h('div', { class: 'lab-controls' },
    single ? null : segBtns([['side', '並列'], ['overlay', '重疊比較']], 'side', (v) => { mode = v; dirty = true; }, '顯示方式'),
    viewBtns);
  const player = h('div', { class: 'lab-player' },
    h('div', { class: 'player-bar' }, playBtn, h('div', { class: 'lab-track' }, marks, slider)),
    h('div', { class: 'controls' }, h('span', { class: 'field-hint' }, '播放速度'),
      segBtns([[0.25, '0.25×'], [0.5, '0.5×'], [1, '1×']], 0.5, (v) => { speed = v; }, '播放速度'), timeEl));
  container.append(controls, stage, player, caption);

  // 時間軸上的關鍵時刻
  const N = opts.steps.length;
  for (const m of opts.moments) {
    if (m.k == null || m.k < 0) continue;
    const pct = (100 * m.k) / Math.max(1, N - 1);
    const shift = pct > 85 ? '-100%' : pct < 15 ? '0%' : '-50%';
    const b = h('button', { type: 'button', class: 'lab-mark', style: `left:${pct}%;transform:translateX(${shift})` }, m.label);
    b.addEventListener('click', () => { focusMoment(m.key, m.k); });
    marks.append(b);
  }

  let mode = 'side', speed = 0.5, pos = 0, playing = false, last = 0, alive = true, dirty = true;
  let freezeUntil = 0, activeMoment = null, highlight = null;
  const baseYaw = (opts.facing && opts.facing.front) || 0;
  const s0 = opts.skeletons[0].seq;
  const fitDist = clamp(((s0.top - s0.floor) / 2 / Math.tan(FOV / 2)) * 1.3, 2.2, 6.5);
  const cam = { yaw: baseYaw + 0.65, pitch: 0.18, dist: fitDist };
  let tween = null;

  function setView(v) {
    const f = opts.facing || { front: 0, side: Math.PI / 2 };
    const target = v === 'front' ? { yaw: f.front, pitch: 0.08 } : v === 'side' ? { yaw: f.side, pitch: 0.08 } : { yaw: cam.yaw, pitch: 1.45 };
    let dy = target.yaw - cam.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    tween = { from: { yaw: cam.yaw, pitch: cam.pitch }, to: { yaw: cam.yaw + dy, pitch: target.pitch }, t0: performance.now(), dur: 450 };
    kick();
  }

  function kick() { dirty = true; }

  // ── 互動：拖曳旋轉、雙指縮放、滾輪縮放 ──
  const pointers = new Map();
  let pinch0 = null;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); pinch0 = null; tween = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      cam.yaw -= (e.clientX - prev[0]) * 0.0105;
      cam.pitch = clamp(cam.pitch + (e.clientY - prev[1]) * 0.0085, -0.35, 1.5);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 == null) pinch0 = { d, dist: cam.dist };
      else cam.dist = clamp(pinch0.dist * (pinch0.d / Math.max(20, d)), 1.6, 8);
    }
    kick();
  });
  const up = (e) => { pointers.delete(e.pointerId); pinch0 = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 1.6, 8); kick(); }, { passive: false });

  // ── 播放控制 ──
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';
  function setPlaying(p) {
    playing = p; last = 0;
    if (p && pos >= N - 1) pos = 0;
    if (p) { activeMoment = null; highlight = null; }
    playBtn.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute('aria-label', p ? '暫停' : '播放');
    notify(); kick();
  }
  playBtn.innerHTML = ICON_PLAY;
  playBtn.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => {
    pos = +slider.value; freezeUntil = 0; highlight = null;
    activeMoment = momentAt(Math.round(pos));
    if (playing) setPlaying(false); else { notify(); kick(); }
  });

  function momentAt(k) {
    const m = opts.moments.find((x) => x.k === k);
    return m ? m.key : null;
  }
  function focusMoment(key, k) {
    pos = k; freezeUntil = 0; activeMoment = key; highlight = null;
    if (playing) setPlaying(false); else { notify(); kick(); }
  }
  function notify() {
    const k = Math.round(pos);
    slider.value = k;
    timeEl.textContent = opts.timeLabel ? opts.timeLabel(k) : '';
    renderCaption();
    if (opts.onPos) opts.onPos(k, playing);
  }
  function renderCaption() {
    caption.replaceChildren();
    if (!activeMoment || !opts.arcsFor) return;
    const m = opts.moments.find((x) => x.key === activeMoment);
    const arcs = opts.arcsFor(activeMoment) || [];
    if (!arcs.length) return;
    caption.append(h('strong', {}, `${m ? m.label : ''}：差異最大的關節`),
      h('ul', {}, arcs.map((a) => h('li', {},
        h('span', { class: 'lab-part' }, a.part),
        h('span', { class: 'lab-val blue' }, `藍 ${Math.round(a.values[0])}°`),
        a.values[1] != null ? h('span', { class: 'lab-val orange' }, `橘 ${Math.round(a.values[1])}°`) : null,
        a.values[1] != null ? h('span', { class: 'lab-diff' }, `差 ${Math.round(Math.abs(a.values[1] - a.values[0]))}°`) : null))));
  }

  // 由外部指定：跳到某個時刻，並把某些關節與骨頭標紅閃爍
  function focus({ k, moment, joints }) {
    pos = clamp(k, 0, N - 1); freezeUntil = 0;
    activeMoment = moment || momentAt(k);
    highlight = { joints, until: performance.now() + 4000 };
    if (playing) setPlaying(false); else { notify(); kick(); }
  }

  // ── 繪圖 ──
  function basis(target) {
    const cp = Math.cos(cam.pitch);
    const P = [target[0] + cam.dist * cp * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * cp * Math.cos(cam.yaw)];
    const f = norm(sub(target, P));
    let r = cross(f, [0, 1, 0]);
    r = len(r) < 1e-6 ? [1, 0, 0] : norm(r);
    const u = cross(r, f);
    return { P, f, r, u };
  }
  function projector(B, vp) {
    const focal = vp.h / 2 / Math.tan(FOV / 2);
    return (X) => {
      const d = sub(X, B.P);
      const z = dot(d, B.f);
      if (z < 0.05) return null;
      return { x: vp.x + vp.w / 2 + (dot(d, B.r) / z) * focal, y: vp.y + vp.h / 2 - (dot(d, B.u) / z) * focal, z, s: focal / z };
    };
  }

  function drawGrid(ctx, pr, floor, dpr) {
    ctx.save();
    ctx.lineWidth = 1 * dpr;
    for (let i = -6; i <= 6; i++) {
      const v = i * 0.25;
      for (const [a, b] of [[[v, floor, -1.5], [v, floor, 1.5]], [[-1.5, floor, v], [1.5, floor, v]]]) {
        const p = pr(a), q = pr(b);
        if (!p || !q) continue;
        ctx.strokeStyle = i === 0 ? 'rgba(120,175,230,0.35)' : 'rgba(120,175,230,0.14)';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSkeleton(ctx, pr, P, color, dpr, hl, t, alpha = 1) {
    const hlJ = new Set(hl ? hl.joints.joints : []);
    const hlB = new Set(hl ? hl.joints.bones.map(([a, b]) => a + '-' + b) : []);
    const flash = hl && Math.floor(t / 180) % 2 === 0;
    const prims = [];
    for (const [a, b] of BONES) {
      const pa = pr(P[a]), pb = pr(P[b]);
      if (!pa || !pb) continue;
      const isHl = hlB.has(a + '-' + b) || hlB.has(b + '-' + a);
      prims.push({ z: (pa.z + pb.z) / 2, kind: 'bone', pa, pb, w: 0.034 * ((pa.s + pb.s) / 2), hl: isHl });
    }
    for (const k of JOINTS) {
      const p = pr(P[k]);
      if (p) prims.push({ z: p.z, kind: 'joint', p, r: 0.028 * p.s, hl: hlJ.has(k) });
    }
    const hp = pr(P[35]);
    if (hp) prims.push({ z: hp.z, kind: 'head', p: hp, r: 0.1 * hp.s });
    prims.sort((a, b) => b.z - a.z);
    const zNear = Math.min(...prims.map((p) => p.z)), zFar = Math.max(...prims.map((p) => p.z));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (const q of prims) {
      const depth = zFar > zNear ? (q.z - zNear) / (zFar - zNear) : 0;
      const k = 1 - depth * 0.35;
      const c = q.hl ? (flash ? COLORS.red : '#FFFFFF') : COLORS[color];
      if (q.kind === 'bone') {
        const w = Math.max(3 * dpr, q.w);
        const line = (lw, style, off = 0) => {
          const dx = q.pb.x - q.pa.x, dy = q.pb.y - q.pa.y, L = Math.hypot(dx, dy) || 1;
          const ox = (-dy / L) * off, oy = (dx / L) * off;
          ctx.strokeStyle = style; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(q.pa.x + ox, q.pa.y + oy); ctx.lineTo(q.pb.x + ox, q.pb.y + oy); ctx.stroke();
        };
        ctx.shadowColor = c; ctx.shadowBlur = 10 * dpr;
        line(w, shade(c.length === 7 ? c : COLORS[color], 0.45 * k));
        ctx.shadowBlur = 0;
        line(w * 0.66, c.length === 7 ? shade(c, k) : c);
        line(w * 0.2, 'rgba(255,255,255,0.55)', -w * 0.16);
      } else {
        const r = Math.max(2.5 * dpr, q.r);
        const g = ctx.createRadialGradient(q.p.x - r * 0.35, q.p.y - r * 0.35, r * 0.1, q.p.x, q.p.y, r);
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(0.35, c.length === 7 ? shade(c, 1.05 * k) : c);
        g.addColorStop(1, c.length === 7 ? shade(c, 0.4 * k) : c);
        if (q.kind === 'head') {
          ctx.globalAlpha = alpha * 0.9;
          ctx.strokeStyle = c.length === 7 ? shade(c, k) : c; ctx.lineWidth = Math.max(2 * dpr, r * 0.22);
          ctx.fillStyle = 'rgba(8,18,28,0.55)';
          ctx.beginPath(); ctx.arc(q.p.x, q.p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.globalAlpha = alpha;
        } else {
          ctx.shadowColor = c; ctx.shadowBlur = q.hl ? 18 * dpr : 6 * dpr;
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.p.x, q.p.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.restore();
  }

  function drawArc(ctx, pr, P, j, color, value, dpr, labelSide) {
    const V = P[j.v], A = P[j.a], C = P[j.c];
    const u = norm(sub(A, V)), v = norm(sub(C, V));
    const th = Math.acos(clamp(dot(u, v), -1, 1));
    const R = 0.11;
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      let d;
      if (th < 1e-3) d = u;
      else d = add(mul(u, Math.sin((1 - t) * th) / Math.sin(th)), mul(v, Math.sin(t * th) / Math.sin(th)));
      const p = pr(add(V, mul(d, R)));
      if (p) pts.push(p);
    }
    if (pts.length < 2) return;
    const c = COLORS[color];
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = 2.5 * dpr; ctx.shadowColor = c; ctx.shadowBlur = 8 * dpr;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.shadowBlur = 0;
    const midDir = norm(add(u, v));
    const lp = pr(add(V, mul(len(midDir) > 0.1 ? midDir : u, R * 1.9)));
    if (lp) {
      const text = `${Math.round(value)}°`;
      ctx.font = `600 ${13 * dpr}px "Barlow Condensed", "Noto Sans TC", sans-serif`;
      const tw = ctx.measureText(text).width, ph = 18 * dpr, pw = tw + 12 * dpr;
      const x = lp.x + (labelSide || 0) * (pw * 0.55), y = lp.y;
      ctx.fillStyle = 'rgba(6,14,22,0.88)'; ctx.strokeStyle = c; ctx.lineWidth = 1.5 * dpr;
      roundRect(ctx, x - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.5 * dpr);
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, hh, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function frameFor(skel, k, overlay) {
    const s = overlay && skel.seqOverlay ? skel.seqOverlay : skel.seq;
    const step = opts.steps[k];
    const idx = skel.index === 'j' ? step[1] : step[0];
    return { P: s.pts[clamp(idx ?? 0, 0, s.pts.length - 1)], seq: s };
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, BG_TOP); bg.addColorStop(1, BG_BOTTOM);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const k = clamp(Math.round(pos), 0, N - 1);
    const overlay = !single && mode === 'overlay';
    const wide = W >= H * 1.05;
    let vps;
    if (single || overlay) vps = [{ x: 0, y: 0, w: W, h: H, skels: opts.skeletons }];
    else if (wide) vps = [{ x: 0, y: 0, w: W / 2, h: H, skels: [opts.skeletons[0]] }, { x: W / 2, y: 0, w: W / 2, h: H, skels: [opts.skeletons[1]] }];
    else vps = [{ x: 0, y: 0, w: W, h: H / 2, skels: [opts.skeletons[0]] }, { x: 0, y: H / 2, w: W, h: H / 2, skels: [opts.skeletons[1]] }];
    const hl = highlight && now < highlight.until ? highlight : null;
    if (highlight && !hl) highlight = null;
    const arcs = activeMoment && opts.arcsFor ? opts.arcsFor(activeMoment) : [];
    vps.forEach((vp, vi) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
      const ref = frameFor(vp.skels[0], k, overlay).seq;
      const target = [0, (ref.floor + ref.top) / 2, 0];
      const B = basis(target);
      const P = projector(B, vp);
      drawGrid(ctx, P, ref.floor, dpr);
      vp.skels.forEach((sk, si) => {
        const { P: pts } = frameFor(sk, k, overlay);
        const skIndex = opts.skeletons.indexOf(sk);
        const hlFor = hl && hl.joints[skIndex] ? { joints: hl.joints[skIndex] } : null;
        drawSkeleton(ctx, P, pts, sk.color, dpr, hlFor, now, overlay && si === 0 ? 0.8 : 1);
        for (const a of arcs) {
          const j = a.joints[skIndex];
          if (j && j.v != null) drawArc(ctx, P, pts, j, sk.color, a.values[skIndex], dpr, overlay ? (si === 0 ? -1 : 1) : 0);
        }
      });
      // 標籤
      ctx.font = `700 ${12.5 * dpr}px "Noto Sans TC", sans-serif`;
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      let ty = vp.y + 12 * dpr;
      for (const sk of vp.skels) {
        ctx.fillStyle = COLORS[sk.color];
        ctx.fillText(sk.tag, vp.x + 14 * dpr, ty);
        ty += 18 * dpr;
      }
      if (vi === 0 && opts.phaseLabel) {
        ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(230,240,248,0.92)';
        ctx.font = `700 ${14 * dpr}px "Noto Sans TC", sans-serif`;
        ctx.fillText(opts.phaseLabel(k) + (freezeUntil > now ? '（定格）' : ''), vp.x + vp.w - 14 * dpr, vp.y + 12 * dpr);
      }
      if (vi > 0) {
        ctx.strokeStyle = 'rgba(120,175,230,0.25)'; ctx.lineWidth = dpr;
        ctx.beginPath();
        if (wide) { ctx.moveTo(vp.x + 0.5, vp.y); ctx.lineTo(vp.x + 0.5, vp.y + vp.h); } else { ctx.moveTo(vp.x, vp.y + 0.5); ctx.lineTo(vp.x + vp.w, vp.y + 0.5); }
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function loop(now) {
    if (!alive) return;
    requestAnimationFrame(loop);
    if (tween) {
      const t = clamp((now - tween.t0) / tween.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      cam.yaw = tween.from.yaw + (tween.to.yaw - tween.from.yaw) * e;
      cam.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * e;
      if (t >= 1) tween = null;
      dirty = true;
    }
    if (playing) {
      if (freezeUntil > now) { dirty = true; }
      else {
        if (freezeUntil) { freezeUntil = 0; }
        const dt = last ? (now - last) / 1000 : 0;
        const prev = pos;
        pos += (dt / (opts.stepSeconds || 1 / 30)) * speed;
        const crossed = opts.moments.find((m) => m.k != null && m.k > Math.floor(prev) && m.k <= pos);
        if (crossed) { pos = crossed.k; freezeUntil = now + 1500; activeMoment = crossed.key; }
        else if (activeMoment && pos - (opts.moments.find((m) => m.key === activeMoment)?.k ?? 0) > 2) activeMoment = null;
        if (pos >= N - 1) { pos = N - 1; setPlaying(false); }
        notify();
        dirty = true;
      }
      last = now;
    }
    if (highlight) dirty = true;
    if (dirty) { dirty = false; draw(now); }
  }
  const ro = new ResizeObserver(() => kick());
  ro.observe(canvas);
  notify();
  requestAnimationFrame(loop);

  return {
    focus, setView, seek: (k) => { pos = clamp(k, 0, N - 1); notify(); kick(); },
    destroy() { alive = false; ro.disconnect(); },
  };
}

// 從示範的第一個影格估計「身體正面」與「持拍手側面」的水平角度
export function facingFrom(seq, idx, hand = 'R') {
  const P = seq.pts[clamp(idx, 0, seq.pts.length - 1)];
  const r = sub(P[12], P[11]);
  const right = norm([r[0], 0, r[2]]);
  const fwd = cross([0, 1, 0], right);
  const front = Math.atan2(fwd[0], fwd[2]);
  const sideDir = hand === 'L' ? mul(right, -1) : right;
  const side = Math.atan2(sideDir[0], sideDir[2]);
  return { front, side };
}
