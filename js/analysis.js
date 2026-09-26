// 動作分析（純函式，不依賴瀏覽器，可單獨測試）
// 姿勢資料格式：frame = { t: 秒, i: [x,y,visibility]*33（影像正規化座標）, w: [x,y,z]*33（世界座標，公尺，以髖部為原點）}
// 手部資料格式：frame = { t, i: [x,y,z]*21, w: [x,y,z]*21 }

const R2D = 180 / Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const angBetween = (u, v) => Math.acos(clamp(dot(u, v) / ((len(u) * len(v)) || 1e-9), -1, 1)) * R2D;
const angleAt = (a, b, c) => angBetween(sub(a, b), sub(c, b));
export const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
export const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}
function std(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map((x) => (x - m) ** 2))); }
function smooth(arr, k = 1) {
  if (k <= 0) return arr.slice();
  return arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) { s += arr[j]; c++; }
    return s / c;
  });
}
function medianFilter(arr, k = 2) {
  return arr.map((_, i) => median(arr.slice(Math.max(0, i - k), Math.min(arr.length, i + k + 1))));
}
function unwrap(arr) {
  const out = [];
  arr.forEach((a, i) => out.push(i === 0 ? wrap180(a) : out[i - 1] + wrap180(a - arr[i - 1])));
  return out;
}
export function scoreLinear(d, good, bad) { return 100 * clamp(1 - (d - good) / (bad - good), 0, 1); }
export function ratioScore(r, span) {
  if (!(r > 0) || !isFinite(r)) return 0;
  return 100 * clamp(1 - Math.abs(Math.log(r)) / Math.log(span), 0, 1);
}
const lerpArr = (a, b, f) => a.map((x, k) => x + (b[k] - x) * f);
const round1 = (x) => Math.round(x);

// ───────────────────────── 揮拍 ─────────────────────────

export const SWING_FEATURES = [
  { key: 'dElbow', label: '持拍手肘角度', w: 1.4, good: 8, bad: 45,
    more: '持拍手臂比示範更伸直，手肘可以保留一點彎曲', less: '持拍手肘彎曲較多，手臂可以再伸展' },
  { key: 'dShoulder', label: '持拍手臂抬起角度', w: 1.3, good: 8, bad: 45,
    more: '持拍手臂抬得比示範高', less: '持拍手臂抬得不夠高，手肘再往上提' },
  { key: 'dWrist', label: '持拍手腕角度', w: 0.6, good: 10, bad: 50,
    more: '手腕比示範更伸直，少了手腕的角度', less: '手腕彎折比示範多，可以稍微回正' },
  { key: 'nElbow', label: '非持拍手肘角度', w: 0.5, good: 10, bad: 50,
    more: '非持拍手伸得比示範直', less: '非持拍手彎曲較多，可以再打開幫助平衡' },
  { key: 'nShoulder', label: '非持拍手抬起角度', w: 0.6, good: 10, bad: 50,
    more: '非持拍手抬得比示範高', less: '非持拍手抬得不夠，舉起來幫助轉體和平衡' },
  { key: 'dKnee', label: '持拍側膝蓋角度', w: 0.7, good: 8, bad: 40,
    more: '持拍側膝蓋比較直，重心可以再降低', less: '持拍側膝蓋彎曲比示範多' },
  { key: 'nKnee', label: '非持拍側膝蓋角度', w: 0.7, good: 8, bad: 40,
    more: '非持拍側膝蓋比較直，重心可以再降低', less: '非持拍側膝蓋彎曲比示範多' },
  { key: 'twist', label: '肩髖扭轉角度', w: 1.0, good: 8, bad: 40, abs: true,
    more: '肩膀和髖部的扭轉比示範大', less: '肩膀和髖部的扭轉不足，引拍時肩膀多轉一些' },
  { key: 'turn', label: '肩膀轉向', w: 0.8, good: 10, bad: 50, wrap: true,
    more: '身體轉向和示範不同，確認轉體時機和拍攝角度', less: '身體轉向和示範不同，確認轉體時機和拍攝角度' },
  { key: 'lean', label: '上半身傾斜角度', w: 0.7, good: 6, bad: 35,
    more: '上半身傾斜比示範多，身體可以再挺一點', less: '上半身比示範挺直，可以依示範稍微傾身' },
];

export const MOMENTS = { top: '引拍頂點', peak: '擊球瞬間', end: '收拍' };

function sides(hand) {
  const R = { S: 12, E: 14, W: 16, I: 20, H: 24, K: 26, A: 28 };
  const L = { S: 11, E: 13, W: 15, I: 19, H: 23, K: 25, A: 27 };
  return hand === 'L' ? { D: L, N: R } : { D: R, N: L };
}

export function resampleFrames(frames, fps = 30) {
  const fr = frames.filter((f) => f && f.w && f.i).sort((a, b) => a.t - b.t);
  if (fr.length < 2) return fr;
  const t0 = fr[0].t, t1 = fr[fr.length - 1].t;
  const n = Math.max(2, Math.round((t1 - t0) * fps) + 1);
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = Math.min(t1, t0 + k / fps);
    while (j < fr.length - 2 && fr[j + 1].t < t) j++;
    const a = fr[j], b = fr[j + 1];
    const f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    out.push({ t, i: lerpArr(a.i, b.i, f), w: lerpArr(a.w, b.w, f) });
  }
  return out;
}

export function swingSeries(frames, hand = 'R') {
  const { D, N } = sides(hand);
  const fx = hand === 'L' ? -1 : 1;
  const W = (f, k) => [f.w[3 * k] * fx, f.w[3 * k + 1], f.w[3 * k + 2]];
  const torso = median(frames.map((f) => len(sub(mid(W(f, 11), W(f, 12)), mid(W(f, 23), W(f, 24)))))) || 0.5;
  const feats = {};
  SWING_FEATURES.forEach((F) => (feats[F.key] = []));
  const pos = [];
  for (const f of frames) {
    const dS = W(f, D.S), dE = W(f, D.E), dW = W(f, D.W), dI = W(f, D.I), dH = W(f, D.H), dK = W(f, D.K), dA = W(f, D.A);
    const nS = W(f, N.S), nE = W(f, N.E), nW = W(f, N.W), nH = W(f, N.H), nK = W(f, N.K), nA = W(f, N.A);
    feats.dElbow.push(angleAt(dS, dE, dW));
    feats.dShoulder.push(angleAt(dH, dS, dE));
    feats.dWrist.push(angleAt(dE, dW, dI));
    feats.nElbow.push(angleAt(nS, nE, nW));
    feats.nShoulder.push(angleAt(nH, nS, nE));
    feats.dKnee.push(angleAt(dH, dK, dA));
    feats.nKnee.push(angleAt(nH, nK, nA));
    const sv = sub(dS, nS), hv = sub(dH, nH);
    const ya = Math.atan2(sv[2], sv[0]) * R2D, yb = Math.atan2(hv[2], hv[0]) * R2D;
    feats.turn.push(ya);
    feats.twist.push(wrap180(ya - yb));
    const sm = mid(dS, nS), hm = mid(dH, nH);
    feats.lean.push(angBetween(sub(sm, hm), [0, -1, 0]));
    pos.push(scale(sub(dW, sm), 1 / torso));
  }
  feats.turn = unwrap(feats.turn);
  for (const k in feats) feats[k] = smooth(feats[k], 1);
  // 先用中位數濾掉單幀辨識錯誤，避免被誤判成揮拍最快點
  const px = smooth(medianFilter(pos.map((p) => p[0])), 1), py = smooth(medianFilter(pos.map((p) => p[1])), 1), pz = smooth(medianFilter(pos.map((p) => p[2])), 1);
  const P = px.map((_, k) => [px[k], py[k], pz[k]]);
  const t = frames.map((f) => f.t);
  const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1 / 30;
  const raw = P.map((_, k) => {
    const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
    const span = (Math.min(P.length - 1, k + 1) - Math.max(0, k - 1)) * dt || dt;
    return len(sub(b, a)) / span;
  });
  return { t, dt, feats, pos: P, speed: smooth(raw, 2), torso, frames, hand };
}

// 找出揮拍片段：以持拍手腕最快的時間點為中心，往前後延伸到手靜止為止
export function detectSegment(S) {
  const sp = S.speed, n = sp.length, dt = S.dt || 1 / 30;
  if (n < 3) return { start: 0, top: 0, peak: 0, end: Math.max(0, n - 1) };
  let peak = 0;
  for (let k = 1; k < n; k++) if (sp[k] > sp[peak]) peak = k;
  const thr = 0.1 * sp[peak];
  const still = Math.max(2, Math.round(0.2 / dt));
  const maxBack = Math.round(2.0 / dt), maxFwd = Math.round(1.2 / dt);
  let start = 0, run = 0, runFirst = -1;
  for (let k = peak; k >= 0; k--) {
    if (peak - k > maxBack) { start = k; break; }
    if (sp[k] < thr) { if (run === 0) runFirst = k; run++; if (run >= still) { start = runFirst; break; } } else run = 0;
    if (k === 0) start = 0;
  }
  let end = n - 1; run = 0; runFirst = -1;
  for (let k = peak; k < n; k++) {
    if (k - peak > maxFwd) { end = k; break; }
    if (sp[k] < thr) { if (run === 0) runFirst = k; run++; if (run >= still) { end = runFirst; break; } } else run = 0;
  }
  if (end - start < 8) { start = Math.max(0, peak - 15); end = Math.min(n - 1, peak + 10); }
  let top = start;
  const a = start + Math.floor(0.2 * (peak - start)), b = peak - 2;
  if (b > a) { top = a; for (let k = a; k <= b; k++) if (sp[k] < sp[top]) top = k; }
  return { start, top, peak, end };
}

function featureVec(S, k, turnOffset = 0) {
  const v = [];
  for (const F of SWING_FEATURES) {
    let x = S.feats[F.key][k];
    if (F.key === 'turn') x += turnOffset;
    v.push((x * F.w) / 15);
  }
  for (const c of S.pos[k]) v.push((c * 1.2) / 0.15);
  return v;
}

export function dtw(A, B) {
  const n = A.length, m = B.length;
  const r = Math.max(Math.abs(n - m) + 2, Math.round(0.3 * Math.max(n, m)));
  const INF = 1e18, M = m + 1;
  const C = new Float64Array((n + 1) * M).fill(INF);
  C[0] = 0;
  const dist = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2; return Math.sqrt(s); };
  for (let i = 1; i <= n; i++) {
    const c = (i * m) / n;
    const lo = Math.max(1, Math.floor(c - r)), hi = Math.min(m, Math.ceil(c + r));
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(C[(i - 1) * M + j], C[i * M + j - 1], C[(i - 1) * M + j - 1]);
      if (best < INF) C[i * M + j] = dist(A[i - 1], B[j - 1]) + best;
    }
  }
  const path = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    if (i === 1 && j === 1) break;
    const d = i > 1 && j > 1 ? C[(i - 1) * M + j - 1] : INF;
    const u = i > 1 ? C[(i - 1) * M + j] : INF;
    const l = j > 1 ? C[i * M + j - 1] : INF;
    if (d <= u && d <= l) { i--; j--; } else if (u <= l) i--; else j--;
  }
  path.reverse();
  return { path, cost: C[n * M + m] / Math.max(1, path.length) };
}

export function normalizePoseSeq(frames, ar = 1, hand = 'R') {
  const fx = hand === 'L' ? -1 : 1;
  const c2 = (f, a, b) => [((f.i[3 * a] + f.i[3 * b]) / 2) * ar, (f.i[3 * a + 1] + f.i[3 * b + 1]) / 2];
  const torso = median(frames.map((f) => { const s = c2(f, 11, 12), hp = c2(f, 23, 24); return Math.hypot(s[0] - hp[0], s[1] - hp[1]); })) || 0.2;
  return frames.map((f) => {
    const hp = c2(f, 23, 24);
    const o = new Array(99);
    for (let k = 0; k < 33; k++) {
      o[3 * k] = ((f.i[3 * k] * ar - hp[0]) * fx) / torso;
      o[3 * k + 1] = (f.i[3 * k + 1] - hp[1]) / torso;
      o[3 * k + 2] = f.i[3 * k + 2];
    }
    return o;
  });
}

export function compareSwing(teacher, student, fps = 30) {
  const T = swingSeries(resampleFrames(teacher.frames, fps), teacher.hand);
  const S = swingSeries(resampleFrames(student.frames, fps), student.hand);
  if (T.t.length < 8 || S.t.length < 8) throw new Error('影片中偵測到的動作太短，無法比對。');
  const ts = detectSegment(T), ss = detectSegment(S);
  // 對齊肩膀轉向的 360° 週期
  const tTurn = mean(T.feats.turn.slice(ts.start, ts.end + 1)), sTurn = mean(S.feats.turn.slice(ss.start, ss.end + 1));
  const turnOffset = -360 * Math.round((sTurn - tTurn) / 360);
  const A = [], B = [];
  for (let k = ts.start; k <= ts.end; k++) A.push(featureVec(T, k));
  for (let k = ss.start; k <= ss.end; k++) B.push(featureVec(S, k, turnOffset));
  const { path: rel } = dtw(A, B);
  const path = rel.map(([i, j]) => [i + ts.start, j + ss.start]);
  const sVal = (key, j) => S.feats[key][j] + (key === 'turn' ? turnOffset : 0);

  // 各關節角度
  const features = SWING_FEATURES.map((F) => {
    const diffs = path.map(([i, j]) => {
      const a = T.feats[F.key][i], b = sVal(F.key, j);
      return F.abs ? Math.abs(b) - Math.abs(a) : b - a;
    });
    const diff = mean(diffs.map(Math.abs));
    return { key: F.key, label: F.label, w: F.w, diff, signed: mean(diffs), score: scoreLinear(diff, F.good, F.bad) };
  });
  const wSum = features.reduce((s, f) => s + f.w, 0);
  const angleScore = features.reduce((s, f) => s + f.score * f.w, 0) / wSum;

  // 軌跡：持拍手腕相對肩膀中心的位置
  const posDist = mean(path.map(([i, j]) => len(sub(S.pos[j], T.pos[i]))));
  const trajScore = scoreLinear(posDist, 0.12, 0.7);

  // 速度與節奏
  const peakT = T.speed[ts.peak], peakS = S.speed[ss.peak];
  const speedRatio = peakS / (peakT || 1e-6);
  const speedPart = speedRatio >= 1 ? ratioScore(speedRatio, 3) : ratioScore(speedRatio, 2.2);
  const tempo = (seg) => (seg.peak - seg.start + 1) / (seg.end - seg.peak + 1);
  const tempoRatio = tempo(ss) / tempo(ts);
  const tempoPart = ratioScore(tempoRatio, 2.5);
  const n = ts.end - ts.start, m = ss.end - ss.start;
  const dev = mean(rel.map(([i, j]) => Math.abs(j / (m || 1) - i / (n || 1))));
  const timingPart = scoreLinear(dev, 0.02, 0.2);
  const speedScore = 0.5 * speedPart + 0.25 * tempoPart + 0.25 * timingPart;

  const total = 0.45 * angleScore + 0.25 * trajScore + 0.3 * speedScore;

  // 關鍵時刻對應
  const mapT2S = (i) => {
    const js = path.filter((p) => p[0] === i).map((p) => p[1]);
    return js.length ? Math.round(median(js)) : ss.start;
  };
  const moments = {};
  for (const key of Object.keys(MOMENTS)) {
    const ti = ts[key];
    const sj = key === 'peak' ? ss.peak : mapT2S(ti);
    moments[key] = { ti, sj };
  }

  // 回饋
  const improve = [], good = [];
  const flagged = new Set();
  for (const F of SWING_FEATURES) {
    let best = null;
    for (const [mk, { ti, sj }] of Object.entries(moments)) {
      const a = T.feats[F.key][ti], b = sVal(F.key, sj);
      const d = F.abs ? Math.abs(b) - Math.abs(a) : b - a;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { mk, d, a: F.abs ? Math.abs(a) : a, b: F.abs ? Math.abs(b) : b };
    }
    const thr = F.w >= 1 ? 12 : 16;
    if (best && Math.abs(best.d) >= thr) {
      const showVals = F.key !== 'turn';
      flagged.add(F.key);
      improve.push({
        sev: Math.abs(best.d) * F.w,
        text: `${MOMENTS[best.mk]}：${best.d > 0 ? F.more : F.less}`,
        detail: showVals ? `你 ${round1(best.b)}°，示範 ${round1(best.a)}°` : `相差約 ${round1(Math.abs(best.d))}°`,
      });
    }
  }
  if (speedRatio < 0.85) improve.push({ sev: (1 - speedRatio) * 60, text: `揮拍最快速度約為示範的 ${Math.round(speedRatio * 100)}%，前揮時再加速`, detail: '速度以身體比例換算，不受身高影響' });
  else if (speedRatio > 1.3) improve.push({ sev: 8, text: '揮拍速度比示範快很多，先確認動作完整、控制穩定', detail: `約為示範的 ${Math.round(speedRatio * 100)}%` });
  if (tempoRatio > 1.4) improve.push({ sev: 14, text: '引拍花的時間相對較長，前揮可以更連貫', detail: '比較的是引拍與隨揮的時間比例' });
  else if (tempoRatio < 0.7) improve.push({ sev: 14, text: '引拍太急，準備動作可以更完整', detail: '比較的是引拍與隨揮的時間比例' });
  const pT = T.pos[ts.peak], pS = S.pos[ss.peak];
  const dy = pS[1] - pT[1];
  if (Math.abs(dy) > 0.15) improve.push({ sev: Math.abs(dy) * 80, text: dy > 0 ? '擊球點比示範低，擊球時手再往上延伸' : '擊球點比示範高', detail: '以肩膀高度為基準比較' });
  const hT = Math.hypot(pT[0], pT[2]), hS = Math.hypot(pS[0], pS[2]);
  if (hT - hS > 0.18) improve.push({ sev: (hT - hS) * 70, text: '擊球點太靠近身體，手臂再往外伸展', detail: '以肩膀中心到手腕的水平距離比較' });
  improve.sort((a, b) => b.sev - a.sev);
  features.filter((f) => f.score >= 85 && f.w >= 0.7 && !flagged.has(f.key)).sort((a, b) => b.score - a.score).slice(0, 3)
    .forEach((f) => good.push({ text: `${f.label}和示範很接近`, detail: `平均相差 ${round1(f.diff)}°` }));
  if (speedPart >= 85) good.push({ text: '揮拍速度和示範相當', detail: `約為示範的 ${Math.round(speedRatio * 100)}%` });
  if (trajScore >= 85) good.push({ text: '持拍手的揮拍軌跡和示範吻合', detail: '' });

  return {
    total, angleScore, trajScore, speedScore,
    parts: { speedRatio, tempoRatio, timingDev: dev, posDist, speedPart, tempoPart, timingPart },
    features, improve: improve.slice(0, 6), good: good.slice(0, 4),
    T, S, ts, ss, path, moments, turnOffset,
  };
}

// ───────────────────────── 握拍 ─────────────────────────

export const FINGERS = [
  ['idx', '食指', [5, 6, 7, 8]],
  ['mid', '中指', [9, 10, 11, 12]],
  ['ring', '無名指', [13, 14, 15, 16]],
  ['pinky', '小指', [17, 18, 19, 20]],
];

export function handFeatures(w, hand = 'R') {
  const fx = hand === 'L' ? -1 : 1;
  const P = (k) => [w[3 * k] * fx, w[3 * k + 1], w[3 * k + 2]];
  const flex = (a, b, c) => 180 - angleAt(P(a), P(b), P(c));
  const f = {};
  for (const [k, , j] of FINGERS) {
    f[k + 'MCP'] = flex(0, j[0], j[1]);
    f[k + 'PIP'] = flex(j[0], j[1], j[2]);
    f[k + 'DIP'] = flex(j[1], j[2], j[3]);
  }
  f.thMCP = flex(1, 2, 3);
  f.thIP = flex(2, 3, 4);
  const palm = len(sub(P(9), P(0))) || 1e-6;
  f.spread = angBetween(sub(P(6), P(5)), sub(P(10), P(9)));
  f.gap = len(sub(P(4), P(6))) / palm;
  f.thReach = len(sub(P(4), P(5))) / palm;
  f.thDir = angBetween(sub(P(4), P(2)), sub(P(9), P(0)));
  return f;
}

export function palmNormalImg(i, ar = 1, hand = 'R') {
  const fx = hand === 'L' ? -1 : 1;
  const P = (k) => [i[3 * k] * ar * fx, i[3 * k + 1], i[3 * k + 2] * ar];
  return nrm(cross(sub(P(5), P(0)), sub(P(17), P(0))));
}

export function racketAngle(view, hand = 'R') {
  if (!view || !view.racket) return null;
  const fx = hand === 'L' ? -1 : 1, ar = view.ar || 1;
  const { head, butt } = view.racket;
  const R = [(head[0] - butt[0]) * ar * fx, head[1] - butt[1]];
  const i = view.hi;
  const H = [(i[27] - i[0]) * ar * fx, i[28] - i[1]];
  return Math.atan2(H[0] * R[1] - H[1] * R[0], H[0] * R[0] + H[1] * R[1]) * R2D;
}

export function averageHand(frames) {
  const n = frames.length;
  const acc = (key) => frames[0][key].map((_, k) => frames.reduce((s, f) => s + f[key][k], 0) / n);
  return { hi: acc('i'), hw: acc('w') };
}

export function rotationSeries(frames, hand = 'R') {
  const fx = hand === 'L' ? -1 : 1;
  let n0 = null;
  const raw = frames.map((f) => {
    const P = (k) => [f.w[3 * k] * fx, f.w[3 * k + 1], f.w[3 * k + 2]];
    const u = nrm(sub(P(9), P(0)));
    const n = nrm(cross(sub(P(5), P(0)), sub(P(17), P(0))));
    if (!n0) n0 = n;
    const p0 = nrm(sub(n0, scale(u, dot(n0, u))));
    const p = nrm(sub(n, scale(u, dot(n, u))));
    return Math.atan2(dot(cross(p0, p), u), dot(p0, p)) * R2D;
  });
  const theta = smooth(unwrap(raw), 2);
  const t = frames.map((f) => f.t - frames[0].t);
  const vel = [];
  for (let k = 2; k < theta.length; k++) {
    const dt = t[k] - t[k - 2];
    if (dt > 0) vel.push(Math.abs(theta[k] - theta[k - 2]) / dt);
  }
  const fl = frames.map((f) => handFeatures(f.w, hand));
  const keys = ['idxMCP', 'idxPIP', 'midMCP', 'midPIP', 'ringMCP', 'pinkyMCP', 'thIP'];
  const stability = mean(keys.map((k) => std(fl.map((x) => x[k]))));
  return { t, theta, range: theta.length ? Math.max(...theta) - Math.min(...theta) : 0, peakVel: percentile(vel, 0.9), stability };
}

const VIEW_NAMES = { back: '手背角度', thumb: '拇指側角度' };

export function compareGrip(teacher, student) {
  const views = ['back', 'thumb'].filter((v) => teacher.views[v] && student.views[v]);
  if (!views.length && !(teacher.rotation && student.rotation)) throw new Error('沒有可以比對的握拍資料。');
  const perView = [];
  const improve = [], good = [];
  const flexAbs = [], thumbScores = [], spreadAbs = [], racketAbs = [];
  const fingerSigned = {};
  const byKey = new Map();
  const addV = (key, v, sev, text, detail) => { if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push({ v, sev, text, detail }); };
  for (const v of views) {
    const T = teacher.views[v], S = student.views[v];
    const tf = handFeatures(T.hw, teacher.hand), sf = handFeatures(S.hw, student.hand);
    const flexKeys = Object.keys(tf).filter((k) => /MCP$|PIP$|DIP$|thIP$/.test(k));
    const d = {};
    for (const k of Object.keys(tf)) d[k] = sf[k] - tf[k];
    flexKeys.forEach((k) => flexAbs.push(Math.abs(d[k])));
    for (const [fk] of FINGERS) (fingerSigned[fk] ||= []).push(mean([d[fk + 'MCP'], d[fk + 'PIP'], d[fk + 'DIP']]));
    (fingerSigned.thumb ||= []).push(mean([d.thMCP, d.thIP]));
    const ts = mean([scoreLinear(Math.abs(d.gap), 0.08, 0.5), scoreLinear(Math.abs(d.thReach), 0.08, 0.5),
      scoreLinear(Math.abs(d.thDir), 8, 40), scoreLinear(mean([Math.abs(d.thMCP), Math.abs(d.thIP)]), 8, 40)]);
    thumbScores.push(ts);
    spreadAbs.push(Math.abs(d.spread));
    const ra = racketAngle(T, teacher.hand), rb = racketAngle(S, student.hand);
    let racket = null;
    if (ra != null && rb != null) { racket = { t: ra, s: rb, diff: wrap180(rb - ra) }; racketAbs.push(Math.abs(racket.diff)); }
    const viewAngle = angBetween(palmNormalImg(T.hi, T.ar, teacher.hand), palmNormalImg(S.hi, S.ar, student.hand));
    perView.push({ view: v, name: VIEW_NAMES[v], d, tf, sf, racket, viewAngle });
    if (viewAngle > 40) improve.push({ sev: 5, text: `${VIEW_NAMES[v]}的拍攝方向和示範差約 ${Math.round(viewAngle)}°，比對結果可能不準`, detail: '請參考示範照片，把手轉到相同方向再拍一次' });
    if (d.gap > 0.18) addV('gap+', v, d.gap * 60, '拇指離食指比示範遠', '拇指可以再靠近食指');
    else if (d.gap < -0.18) addV('gap-', v, -d.gap * 60, '拇指比示範更貼近食指', '拇指可以稍微分開');
    if (Math.abs(d.thDir) > 15) addV('thDir' + Math.sign(d.thDir), v, Math.abs(d.thDir) * 0.8, `拇指方向和示範差約 ${Math.round(Math.abs(d.thDir))}°`, d.thDir > 0 ? '拇指比示範更往外張開' : '拇指比示範更往手指方向收');
    if (d.spread < -8) addV('spread-', v, -d.spread, '食指和中指靠得比示範近', '食指可以稍微往前分開，像扣扳機的位置');
    else if (d.spread > 8) addV('spread+', v, d.spread, '食指張得比示範開', '食指可以收回來一些');
    if (racket && Math.abs(racket.diff) > 10) addV('racket', v, Math.abs(racket.diff) * 1.2, `球拍和手的夾角與示範差 ${Math.round(Math.abs(racket.diff))}°`, '拍柄在手中的角度不同，檢查虎口對準的位置');
  }
  for (const items of byKey.values()) {
    const best = items.reduce((a, b) => (b.sev > a.sev ? b : a));
    improve.push({ sev: best.sev, text: items.length > 1 ? `兩個角度都顯示：${best.text}` : `${VIEW_NAMES[best.v]}：${best.text}`, detail: best.detail });
  }
  const names = { idx: '食指', mid: '中指', ring: '無名指', pinky: '小指', thumb: '拇指' };
  for (const [fk, arr] of Object.entries(fingerSigned)) {
    const v = mean(arr);
    if (v > 15) improve.push({ sev: v, text: `${names[fk]}彎曲比示範多約 ${Math.round(v)}°`, detail: fk === 'thumb' ? '拇指可以再伸直貼住拍柄' : '握得偏緊，可以稍微放鬆' });
    else if (v < -15) improve.push({ sev: -v, text: `${names[fk]}比示範伸直約 ${Math.round(-v)}°`, detail: fk === 'thumb' ? '拇指可以再彎一些扣住拍柄' : '手指可以再包覆拍柄' });
  }

  const parts = [];
  if (views.length) {
    parts.push({ key: 'flex', label: '手指彎曲', w: 0.3, score: scoreLinear(mean(flexAbs), 8, 40) });
    parts.push({ key: 'thumb', label: '拇指位置', w: 0.25, score: mean(thumbScores) });
    parts.push({ key: 'spread', label: '食指張開', w: 0.1, score: scoreLinear(mean(spreadAbs), 5, 30) });
    if (racketAbs.length) parts.push({ key: 'racket', label: '球拍夾角', w: 0.15, score: scoreLinear(mean(racketAbs), 6, 35) });
  }
  let rotation = null;
  if (teacher.rotation && student.rotation && teacher.rotation.frames.length > 10 && student.rotation.frames.length > 10) {
    const rT = rotationSeries(teacher.rotation.frames, teacher.hand), rS = rotationSeries(student.rotation.frames, student.hand);
    const rr = rS.range / (rT.range || 1), vr = rS.peakVel / (rT.peakVel || 1);
    const rangeScore = rr >= 1 ? ratioScore(rr, 4) : ratioScore(rr, 2.5);
    const velScore = vr >= 1 ? ratioScore(vr, 4) : ratioScore(vr, 2.5);
    const stabScore = scoreLinear(Math.max(0, rS.stability - Math.max(rT.stability, 3)), 2, 15);
    rotation = { rT, rS, rr, vr, rangeScore, velScore, stabScore };
    parts.push({ key: 'rotation', label: '手腕轉動', w: 0.2, score: 0.4 * rangeScore + 0.35 * velScore + 0.25 * stabScore });
    if (rr < 0.75) improve.push({ sev: (1 - rr) * 40, text: `前臂轉動幅度約為示範的 ${Math.round(rr * 100)}%`, detail: '轉動時可以轉得更充分' });
    if (vr < 0.7) improve.push({ sev: (1 - vr) * 35, text: `前臂轉動速度約為示範的 ${Math.round(vr * 100)}%`, detail: '熟悉後可以加快轉動' });
    if (stabScore < 60) improve.push({ sev: 20, text: '轉動時手指位置跑掉了', detail: '轉動前臂時保持握法不變' });
    if (rangeScore >= 85 && velScore >= 80) good.push({ text: '手腕轉動的幅度和速度都接近示範', detail: '' });
  }
  const wSum = parts.reduce((s, p) => s + p.w, 0) || 1;
  const total = parts.reduce((s, p) => s + p.score * p.w, 0) / wSum;
  parts.filter((p) => p.score >= 85 && p.key !== 'rotation').forEach((p) => good.push({ text: `${p.label}和示範很接近`, detail: '' }));
  improve.sort((a, b) => b.sev - a.sev);
  return { total, parts, perView, rotation, improve: improve.slice(0, 6), good: good.slice(0, 4) };
}
