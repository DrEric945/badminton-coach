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

export function sides(hand) {
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
// 以某個速度高峰為中心找出一次揮拍的範圍（lo、hi 為可延伸的界線，避免和相鄰的球重疊）
function segmentAround(S, peak, lo, hi) {
  const sp = S.speed, dt = S.dt || 1 / 30;
  const thr = 0.1 * sp[peak];
  const still = Math.max(2, Math.round(0.2 / dt));
  const maxBack = Math.round(2.0 / dt), maxFwd = Math.round(1.2 / dt);
  let start = lo, run = 0, runFirst = -1;
  for (let k = peak; k >= lo; k--) {
    if (peak - k > maxBack) { start = k; break; }
    if (sp[k] < thr) { if (run === 0) runFirst = k; run++; if (run >= still) { start = runFirst; break; } } else run = 0;
    if (k === lo) start = lo;
  }
  let end = hi; run = 0; runFirst = -1;
  for (let k = peak; k <= hi; k++) {
    if (k - peak > maxFwd) { end = k; break; }
    if (sp[k] < thr) { if (run === 0) runFirst = k; run++; if (run >= still) { end = runFirst; break; } } else run = 0;
  }
  if (end - start < 8) { start = Math.max(lo, peak - 15); end = Math.min(hi, peak + 10); }
  let top = start;
  const a = start + Math.floor(0.2 * (peak - start)), b = peak - 2;
  if (b > a) { top = a; for (let k = a; k <= b; k++) if (sp[k] < sp[top]) top = k; }
  return { start, top, peak, end };
}

// 找出影片中最主要的一次揮拍（持拍手腕最快的瞬間）
export function detectSegment(S) {
  const sp = S.speed, n = sp.length;
  if (n < 3) return { start: 0, top: 0, peak: 0, end: Math.max(0, n - 1) };
  let peak = 0;
  for (let k = 1; k < n; k++) if (sp[k] > sp[peak]) peak = k;
  return segmentAround(S, peak, 0, n - 1);
}

// 找出影片中的每一次揮拍：速度高峰要夠高、彼此間隔夠久，而且中間手要有明顯放慢（回到準備）
// 手腕在第 k 格的移動方向（以軀幹長度正規化的座標）
export function wristDir(S, k) {
  const a = S.pos[Math.max(0, k - 1)], b = S.pos[Math.min(S.pos.length - 1, k + 1)];
  return nrm(sub(b, a));
}

// refDir：示範擊球瞬間的手腕移動方向。只把方向相近的速度高峰當成揮拍，排除收拍後把拍子拉回的動作
export function detectSegments(S, { minRatio = 0.55, minGapSec = 1.0, valleyRatio = 0.35, refDir = null } = {}) {
  const sp = S.speed, n = sp.length, dt = S.dt || 1 / 30;
  if (n < 3) return [detectSegment(S)];
  const max = Math.max(...sp);
  let cand = [];
  for (let k = 1; k < n - 1; k++) if (sp[k] >= sp[k - 1] && sp[k] > sp[k + 1] && sp[k] >= minRatio * max) cand.push(k);
  if (refDir) {
    const same = cand.filter((k) => dot(wristDir(S, k), refDir) > 0);
    if (same.length) cand = same;
  }
  cand.sort((a, b) => sp[b] - sp[a]);
  const chosen = [];
  for (const p of cand) {
    if (chosen.every((q) => Math.abs(p - q) * dt >= minGapSec)) chosen.push(p);
  }
  chosen.sort((a, b) => a - b);
  // 兩個高峰之間沒有明顯放慢，代表是同一次揮拍（例如引拍和前揮），保留較快的那個
  const peaks = [];
  for (const p of chosen) {
    const q = peaks[peaks.length - 1];
    if (q == null) { peaks.push(p); continue; }
    let valley = Infinity;
    for (let k = q; k <= p; k++) valley = Math.min(valley, sp[k]);
    if (valley < valleyRatio * Math.min(sp[p], sp[q])) peaks.push(p);
    else if (sp[p] > sp[q]) peaks[peaks.length - 1] = p;
  }
  if (!peaks.length) return [detectSegment(S)];
  const segs = peaks.map((p, i) => {
    const lo = i === 0 ? 0 : Math.round((peaks[i - 1] + p) / 2) + 1;
    const hi = i === peaks.length - 1 ? n - 1 : Math.round((p + peaks[i + 1]) / 2);
    return segmentAround(S, p, lo, hi);
  });
  // 影片開頭或結尾被切掉一半的揮拍不列入（至少保留一球）
  const whole = segs.filter((g) => !((g.end >= n - 1 && (g.end - g.peak) * dt < 0.25) || (g.start <= 0 && (g.peak - g.start) * dt < 0.3)));
  return whole.length ? whole : segs;
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

export function compareSwing(teacher, student, fps = 30, opts = {}) {
  const T = swingSeries(resampleFrames(teacher.frames, fps), teacher.hand);
  const S = swingSeries(resampleFrames(student.frames, fps), student.hand);
  if (T.t.length < 8 || S.t.length < 8) throw new Error('影片中偵測到的動作太短，無法比對。');
  const ts = detectSegment(T);
  const ss = opts.shot != null ? (detectSegments(S, { refDir: wristDir(T, ts.peak) })[opts.shot] || detectSegment(S)) : detectSegment(S);
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

// ───────────────────────── 3D 實驗室 ─────────────────────────

// 每個特徵對應的關節（v 為角度頂點，a、c 為兩端）與要標示的骨頭；33、34 是 3D 檢視器的肩膀中心與髖部中心
const FEATURE_JOINTS = {
  dElbow: { side: 'D', v: 'E', a: 'S', c: 'W' },
  dShoulder: { side: 'D', v: 'S', a: 'H', c: 'E' },
  dWrist: { side: 'D', v: 'W', a: 'E', c: 'I' },
  nElbow: { side: 'N', v: 'E', a: 'S', c: 'W' },
  nShoulder: { side: 'N', v: 'S', a: 'H', c: 'E' },
  dKnee: { side: 'D', v: 'K', a: 'H', c: 'A' },
  nKnee: { side: 'N', v: 'K', a: 'H', c: 'A' },
  twist: { bones: [[11, 12], [23, 24]], joints: [11, 12, 23, 24] },
  turn: { bones: [[11, 12]], joints: [11, 12] },
  lean: { bones: [[33, 34]], joints: [11, 12, 23, 24] },
  wristPos: { side: 'D', jointKeys: ['W', 'I'], boneKeys: [['E', 'W'], ['W', 'I']] },
  speed: { side: 'D', jointKeys: ['E', 'W'], boneKeys: [['S', 'E'], ['E', 'W'], ['W', 'I']] },
};

export function featureJoints(key, hand = 'R') {
  const def = FEATURE_JOINTS[key];
  if (!def) return { joints: [], bones: [] };
  const sd = def.side ? sides(hand)[def.side] : null;
  if (def.v) {
    const v = sd[def.v], a = sd[def.a], c = sd[def.c];
    return { v, a, c, joints: [v], bones: [[a, v], [v, c]] };
  }
  if (def.jointKeys) return { joints: def.jointKeys.map((k) => sd[k]), bones: def.boneKeys.map(([x, y]) => [sd[x], sd[y]]) };
  return { joints: def.joints.slice(), bones: def.bones.map((b) => b.slice()) };
}

// 比較藍色（示範）與橘色（學生）在三個關鍵時刻的差異，給 3D 實驗室使用
export function labDifferences(R) {
  const { T, S, path, moments, turnOffset } = R;
  const momentK = {};
  for (const key of Object.keys(MOMENTS)) {
    const ti = moments[key].ti;
    let k = path.findIndex((p) => p[0] === ti);
    if (k < 0) k = key === 'end' ? path.length - 1 : 0;
    momentK[key] = k;
  }
  const value = (F, who, idx) => {
    let v = (who === 'T' ? T : S).feats[F.key][idx] + (who === 'S' && F.key === 'turn' ? turnOffset : 0);
    return F.abs ? Math.abs(v) : v;
  };
  const items = [], arcs = {}, worst = {};
  for (const [mkey, k] of Object.entries(momentK)) {
    const [i, j] = path[k];
    const rows = [];
    for (const F of SWING_FEATURES) {
      const t = value(F, 'T', i), sv = value(F, 'S', j);
      const d = F.wrap ? wrap180(sv - t) : sv - t;
      rows.push({ F, t, s: sv, d });
      worst[F.key] = Math.max(worst[F.key] || 0, Math.abs(d));
      const strong = Math.max(2 * F.good, 15), mild = F.good + 4;
      if (Math.abs(d) >= mild) {
        const show = F.key !== 'turn';
        items.push({
          moment: mkey, momentLabel: MOMENTS[mkey], k, featureKey: F.key, part: F.label,
          teacherText: show ? `${Math.round(t)}°` : null, studentText: show ? `${Math.round(sv)}°` : null,
          diffText: show ? `${d > 0 ? '+' : ''}${Math.round(d)}°` : `相差 ${Math.round(Math.abs(d))}°`,
          severity: Math.abs(d) >= strong ? '明顯' : '輕微', advice: d > 0 ? F.more : F.less, sev: Math.abs(d) * F.w,
          drill: drillFor(F.key, d > 0 ? '+' : '-'),
        });
      }
    }
    arcs[mkey] = rows.filter((r) => FEATURE_JOINTS[r.F.key] && FEATURE_JOINTS[r.F.key].v)
      .sort((a, b) => Math.abs(b.d) * b.F.w - Math.abs(a.d) * a.F.w).slice(0, 3)
      .map((r) => ({ featureKey: r.F.key, part: r.F.label, teacher: r.t, student: r.s, diff: r.d }));
  }
  // 擊球點位置與揮拍速度
  const kp = momentK.peak, [ip, jp] = path[kp];
  const pT = T.pos[ip], pS = S.pos[jp];
  const cm = (x) => Math.round(Math.abs(x) * (T.torso || 0.5) * 100);
  const dy = pS[1] - pT[1];
  if (Math.abs(dy) > 0.1) items.push({
    moment: 'peak', momentLabel: MOMENTS.peak, k: kp, featureKey: 'wristPos', part: '擊球點高度',
    teacherText: null, studentText: null, diffText: `${dy > 0 ? '低' : '高'}約 ${cm(dy)} 公分`,
    severity: Math.abs(dy) > 0.2 ? '明顯' : '輕微', advice: dy > 0 ? '擊球點比示範低，擊球時手再往上延伸' : '擊球點比示範高', sev: Math.abs(dy) * 80,
    drill: dy > 0 ? drillFor('wristPos', '+') : null,
  });
  const reachT = Math.hypot(pT[0], pT[2]), reachS = Math.hypot(pS[0], pS[2]);
  if (reachT - reachS > 0.12) items.push({
    moment: 'peak', momentLabel: MOMENTS.peak, k: kp, featureKey: 'wristPos', part: '擊球點與身體的距離',
    teacherText: null, studentText: null, diffText: `近約 ${cm(reachT - reachS)} 公分`,
    severity: reachT - reachS > 0.22 ? '明顯' : '輕微', advice: '擊球點太靠近身體，手臂再往外伸展', sev: (reachT - reachS) * 70,
    drill: drillFor('wristPos', '-'),
  });
  const r = R.parts.speedRatio;
  if (r < 0.85 || r > 1.3) items.push({
    moment: 'peak', momentLabel: MOMENTS.peak, k: kp, featureKey: 'speed', part: '揮拍速度',
    teacherText: '100%', studentText: `${Math.round(r * 100)}%`, diffText: `${r < 1 ? '慢' : '快'} ${Math.round(Math.abs(1 - r) * 100)}%`,
    severity: r < 0.7 || r > 1.5 ? '明顯' : '輕微',
    advice: r < 1 ? '前揮時再加速，速度以身體比例換算，不受身高影響' : '速度比示範快很多，先確認動作完整、控制穩定', sev: Math.abs(1 - r) * 60,
    drill: drillFor('speed', r < 1 ? '-' : '+'),
  });
  // 同一個部位、同一個方向在多個時刻都有差異時，保留差最多的那一次，其他時刻列在 alsoAt
  const merged = new Map();
  for (const it of items) {
    const key = it.featureKey + (it.diffText.startsWith('-') ? '-' : '+') + (it.featureKey === 'wristPos' ? it.part : '');
    const cur = merged.get(key);
    if (!cur) merged.set(key, { ...it, alsoAt: [] });
    else if (it.sev > cur.sev) merged.set(key, { ...it, alsoAt: [...cur.alsoAt, cur.momentLabel] });
    else cur.alsoAt.push(it.momentLabel);
  }
  items.length = 0;
  items.push(...merged.values());
  items.sort((a, b) => b.sev - a.sev);
  const matches = [];
  for (const F of SWING_FEATURES) {
    if (F.w < 0.6) continue;
    if ((worst[F.key] ?? 99) < F.good + 4) matches.push({ part: F.label, text: `三個關鍵時刻都和示範相差不到 ${Math.max(1, Math.ceil(worst[F.key]))}°` });
  }
  if (r >= 0.85 && r <= 1.3) matches.push({ part: '揮拍速度', text: `約為示範的 ${Math.round(r * 100)}%，節奏相當` });
  return { items, matches, arcs, momentK };
}

// ───────────────────────── 多球分析 ─────────────────────────

// 一段影片中有多次揮拍時，逐球和示範比對，並統計每個問題出現在幾球
export function compareSwingShots(teacher, student, fps = 30) {
  const S = swingSeries(resampleFrames(student.frames, fps), student.hand);
  const T = swingSeries(resampleFrames(teacher.frames, fps), teacher.hand);
  const refDir = T.t.length >= 8 ? wristDir(T, detectSegment(T).peak) : null;
  const segs = S.t.length >= 8 ? detectSegments(S, { refDir }) : [];
  if (segs.length <= 1) {
    const R = compareSwing(teacher, student, fps);
    return { shots: [{ index: 0, R, t: R.S.t[R.ss.peak] }], summary: shotSummary([{ index: 0, R }]) };
  }
  const shots = segs.map((seg, i) => {
    const R = compareSwing(teacher, student, fps, { shot: i });
    return { index: i, R, t: R.S.t[R.ss.peak] };
  });
  return { shots, summary: shotSummary(shots) };
}

function shotSummary(shots) {
  const n = shots.length;
  const freq = new Map();
  shots.forEach((sh) => {
    const D = labDifferences(sh.R);
    sh.diffCount = D.items.length;
    sh.strongCount = D.items.filter((x) => x.severity === '明顯').length;
    for (const it of D.items) {
      const key = it.featureKey + (it.diffText.startsWith('-') || it.diffText.startsWith('低') || it.diffText.startsWith('近') || it.diffText.startsWith('慢') ? '-' : '+') + it.part;
      const f = freq.get(key) || { key, part: it.part, advice: it.advice, drill: it.drill, count: 0, shots: [], sev: 0 };
      f.count++; f.shots.push(sh.index); f.sev = Math.max(f.sev, it.sev);
      freq.set(key, f);
    }
  });
  const issues = [...freq.values()].sort((a, b) => b.count - a.count || b.sev - a.sev);
  const totals = shots.map((s) => s.R.total);
  const best = shots.reduce((a, b) => (b.R.total > a.R.total ? b : a));
  const worst = shots.reduce((a, b) => (b.R.total < a.R.total ? b : a));
  return { count: n, avg: mean(totals), best: best.index, worst: worst.index, issues };
}

// 目前畫面的即時數據（3D 實驗室左側的數據表）
export function metricsAt(R, k) {
  const [i, j] = R.path[Math.max(0, Math.min(R.path.length - 1, k))];
  const row = (label, key, unit = '°', transform = (x) => x) => {
    const F = SWING_FEATURES.find((f) => f.key === key);
    const t = transform(R.T.feats[key][i]), sv = transform(R.S.feats[key][j]);
    return { label, teacher: t, student: sv, diff: sv - t, unit, warn: Math.abs(sv - t) >= (F ? F.good + 4 : 12) };
  };
  const cm = (who, idx) => -(who.pos[idx][1]) * (R.T.torso || 0.5) * 100;
  const hT = cm(R.T, i), hS = cm(R.S, j);
  return [
    row('上半身傾斜', 'lean'),
    row('持拍手肘', 'dElbow'),
    row('持拍手臂抬起', 'dShoulder'),
    row('肩髖扭轉', 'twist', '°', Math.abs),
    row('持拍側膝蓋', 'dKnee'),
    row('非持拍手抬起', 'nShoulder'),
    { label: '手腕高度（相對肩膀）', teacher: hT, student: hS, diff: hS - hT, unit: '公分', warn: Math.abs(hS - hT) > 12 },
  ];
}

// ───────────────────────── 練習方法 ─────────────────────────
// 依「學生比示範大（+）／小（-）」給對應的練習。羽球範例，其他運動請依專項改寫。
export const DRILLS = {
  'dElbow-': { name: '高點伸展觸牌練習', how: '在牆上比頭高約一個球拍長的位置貼一張標記。側身站好，做完整揮拍，在最高點用拍面輕碰標記，讓持拍手臂在擊球瞬間接近伸直。', dose: '10 次 × 3 組', cue: '擊球瞬間手肘接近伸直，不要縮著手打' },
  'dElbow+': { name: '手肘放鬆引拍', how: '對著鏡子慢動作空揮：引拍時手肘保持約 90 度彎曲、拍頭朝上，前揮時再把手臂展開。', dose: '15 次 × 2 組', cue: '引拍時手肘彎曲，前揮才伸直' },
  'dShoulder-': { name: '手肘上提定格', how: '引拍時把持拍手的手肘抬到和肩膀一樣高，停 2 秒確認姿勢，再往前上方揮出。', dose: '12 次 × 3 組', cue: '手肘和肩膀同高，不要夾在身體旁' },
  'dShoulder+': { name: '引拍高度控制', how: '對著鏡子引拍，手肘高度維持在肩膀附近，不要把整隻手臂舉過頭。', dose: '12 次 × 2 組', cue: '手肘約與肩同高即可' },
  'dWrist-': { name: '前臂轉動空揮', how: '握拍放鬆，揮拍時用前臂內旋帶動拍面由側面轉正，手腕保持自然角度，不要用手腕甩拍。', dose: '20 次 × 2 組', cue: '靠前臂轉動，手腕不要折' },
  'dWrist+': { name: '自然翹腕引拍', how: '引拍時手腕自然向後翹起，擊球瞬間再隨前臂轉動釋放，感受「鞭打」的順序。', dose: '15 次 × 2 組', cue: '引拍翹腕、擊球才釋放' },
  'nShoulder-': { name: '非持拍手指球', how: '請同伴拋高球，引拍時舉起非持拍手指向來球，擊球時再把手收回胸前帶動轉體。', dose: '10 球 × 3 組', cue: '左手（非持拍手）舉起指球' },
  'nShoulder+': { name: '非持拍手自然舉起', how: '引拍時非持拍手舉到眼睛高度即可，不必高舉過頭，保持身體平衡。', dose: '10 次 × 2 組', cue: '非持拍手約與眼同高' },
  'nElbow-': { name: '非持拍手打開', how: '引拍時非持拍手的手臂向前上方打開，像在指球，不要縮在胸前。', dose: '10 次 × 3 組', cue: '手臂打開，幫助平衡' },
  'nElbow+': { name: '非持拍手放鬆', how: '非持拍手自然微彎指球，不用刻意打直。', dose: '10 次 × 2 組', cue: '手臂微彎、放鬆' },
  'twist-': { name: '側身轉肩練習', how: '雙手把球拍橫放在肩後，側身站立，轉動肩膀讓球拍一端指向後方，再轉回正面。之後改成正常引拍，感覺肩膀比髖部多轉一些。', dose: '15 次 × 3 組', cue: '引拍時肩膀轉向側面，背部對著來球方向' },
  'twist+': { name: '轉體幅度控制', how: '對著鏡子引拍，肩膀轉到側面即可，避免轉過頭導致回位太慢。', dose: '12 次 × 2 組', cue: '轉到側面就好' },
  'turn-': { name: '側身站位練習', how: '聽口令從準備姿勢做側身跨步，持拍側的腳往後退一步，肩膀轉向側面後定格。', dose: '10 次 × 3 組', cue: '先側身，再揮拍' },
  'turn+': { name: '側身站位練習', how: '聽口令從準備姿勢做側身跨步，持拍側的腳往後退一步，肩膀轉向側面後定格。', dose: '10 次 × 3 組', cue: '先側身，再揮拍' },
  'dKnee+': { name: '降低重心步法', how: '準備姿勢時膝蓋微彎、重心放在前腳掌，原地小碎步後分腿站定，再做一次揮拍。', dose: '20 次 × 3 組', cue: '膝蓋微彎，重心放低' },
  'dKnee-': { name: '重心高度調整', how: '準備時膝蓋微彎即可，不需要蹲太低；擊球時由後腳蹬地帶動身體向上。', dose: '15 次 × 2 組', cue: '微蹲、蹬地向上' },
  'nKnee+': { name: '降低重心步法', how: '準備姿勢時膝蓋微彎、重心放在前腳掌，原地小碎步後分腿站定，再做一次揮拍。', dose: '20 次 × 3 組', cue: '膝蓋微彎，重心放低' },
  'nKnee-': { name: '重心高度調整', how: '準備時膝蓋微彎即可，不需要蹲太低。', dose: '15 次 × 2 組', cue: '微蹲即可' },
  'lean+': { name: '軀幹穩定揮拍', how: '對著鏡子揮拍，注意上半身保持挺直，只有在擊球後才順勢前傾。', dose: '12 次 × 2 組', cue: '揮拍時上半身挺直' },
  'lean-': { name: '順勢前傾', how: '擊球後讓上半身順著揮拍方向自然前傾，重心移到前腳。', dose: '12 次 × 2 組', cue: '擊球後身體跟著往前' },
  'wristPos+': { name: '最高點擊球多球', how: '請同伴或教練拋高球，要求在頭頂前上方、手臂伸直的最高點擊球，打不到最高點就重來。', dose: '10 球 × 3 組', cue: '在最高點擊球' },
  'wristPos-': { name: '擊球點前移', how: '在身體前方約一個球拍長的位置放一個標記，揮拍時讓擊球點落在標記上方，不要讓球太靠近身體。', dose: '10 球 × 3 組', cue: '擊球點在身體前方' },
  'speed-': { name: '爆發揮拍練習', how: '先套上拍套（或用較重的拍子）空揮 10 次，再換回一般球拍快速揮 10 次，聽揮拍的風聲，越響越好。', dose: '3 回合', cue: '前揮時突然加速' },
  'speed+': { name: '完整動作再加速', how: '先用七成力量做完整揮拍，確認引拍、擊球、收拍都到位，再逐步加快。', dose: '15 次 × 2 組', cue: '動作完整比速度重要' },
};

export function drillFor(featureKey, sign) {
  return DRILLS[featureKey + sign] || null;
}

// 依差異清單挑出最重要的練習（同一種練習只出現一次）
export function practicePlan(items, max = 3) {
  const seen = new Set(), plan = [];
  for (const it of items) {
    if (!it.drill || seen.has(it.drill.name)) continue;
    seen.add(it.drill.name);
    plan.push({ ...it.drill, reason: `${it.momentLabel}：${it.part}${it.diffText ? '（' + it.diffText + '）' : ''}` });
    if (plan.length >= max) break;
  }
  return plan;
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

// 握把頭（握把尾端）到手腕的距離，以手掌長度為單位；越大代表握得越靠上
export function buttDistance(view) {
  if (!view || !view.racket || !view.racket.butt) return null;
  const ar = view.ar || 1, i = view.hi, b = view.racket.butt;
  const palm = Math.hypot((i[27] - i[0]) * ar, i[28] - i[1]) || 1e-6;
  return Math.hypot((b[0] - i[0]) * ar, b[1] - i[1]) / palm;
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
  const flexAbs = [], thumbScores = [], spreadAbs = [], racketAbs = [], buttAbs = [];
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
    if (ra != null && rb != null) {
      racket = { t: ra, s: rb, diff: wrap180(rb - ra) };
      racketAbs.push(Math.abs(racket.diff));
      const bT = buttDistance(T), bS = buttDistance(S);
      if (bT != null && bS != null) { racket.buttT = bT; racket.buttS = bS; racket.buttDiff = bS - bT; buttAbs.push(Math.abs(bS - bT)); }
    }
    const viewAngle = angBetween(palmNormalImg(T.hi, T.ar, teacher.hand), palmNormalImg(S.hi, S.ar, student.hand));
    perView.push({ view: v, name: VIEW_NAMES[v], d, tf, sf, racket, viewAngle });
    if (viewAngle > 40) improve.push({ sev: 5, text: `${VIEW_NAMES[v]}的拍攝方向和示範差約 ${Math.round(viewAngle)}°，比對結果可能不準`, detail: '請參考示範照片，把手轉到相同方向再拍一次' });
    if (d.gap > 0.18) addV('gap+', v, d.gap * 60, '拇指離食指比示範遠', '拇指可以再靠近食指');
    else if (d.gap < -0.18) addV('gap-', v, -d.gap * 60, '拇指比示範更貼近食指', '拇指可以稍微分開');
    if (Math.abs(d.thDir) > 15) addV('thDir' + Math.sign(d.thDir), v, Math.abs(d.thDir) * 0.8, `拇指方向和示範差約 ${Math.round(Math.abs(d.thDir))}°`, d.thDir > 0 ? '拇指比示範更往外張開' : '拇指比示範更往手指方向收');
    if (d.spread < -8) addV('spread-', v, -d.spread, '食指和中指靠得比示範近', '食指可以稍微往前分開，像扣扳機的位置');
    else if (d.spread > 8) addV('spread+', v, d.spread, '食指張得比示範開', '食指可以收回來一些');
    if (racket && Math.abs(racket.diff) > 10) addV('racket', v, Math.abs(racket.diff) * 1.2, `握把和手的夾角與示範差 ${Math.round(Math.abs(racket.diff))}°`, '握把在手中的角度不同，檢查虎口對準的位置');
    if (racket && racket.buttDiff > 0.25) addV('butt+', v, racket.buttDiff * 40, '握的位置比示範高（握把頭露出較多）', '手可以往握把頭的方向移一些');
    else if (racket && racket.buttDiff < -0.25) addV('butt-', v, -racket.buttDiff * 40, '握的位置比示範低（太靠近握把頭）', '手可以往上握一些');
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
    if (racketAbs.length) {
      const angleScore = scoreLinear(mean(racketAbs), 6, 35);
      const posScore = buttAbs.length ? scoreLinear(mean(buttAbs), 0.1, 0.6) : angleScore;
      parts.push({ key: 'racket', label: '握把方向', w: 0.2, score: 0.6 * angleScore + 0.4 * posScore });
    }
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
