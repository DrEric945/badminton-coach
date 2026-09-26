// 影像辨識：MediaPipe Tasks Vision（在使用者的裝置上運算，不上傳影片）
export const TASKS_VERSION = '0.10.14';
const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const MODELS = {
  poseLite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseFull: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

let visionPromise = null;
const cache = {};
const lastTs = new WeakMap();

async function vision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      let mod;
      try { mod = await import(`${TASKS_BASE}/vision_bundle.mjs`); }
      catch (e) { console.warn('改用 jsDelivr +esm 載入', e); mod = await import(`${TASKS_BASE}/+esm`); }
      const fileset = await mod.FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
      return { mod, fileset };
    })().catch((e) => { visionPromise = null; throw e; });
  }
  return visionPromise;
}

async function create(Kind, fileset, opts) {
  try {
    return await Kind.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    console.warn('GPU 模式失敗，改用 CPU', e);
    return Kind.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
  }
}

export async function getPose(quality = 'full') {
  const key = 'pose-' + quality;
  if (!cache[key]) {
    cache[key] = (async () => {
      const { mod, fileset } = await vision();
      return create(mod.PoseLandmarker, fileset, {
        baseOptions: { modelAssetPath: quality === 'lite' ? MODELS.poseLite : MODELS.poseFull },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
    })().catch((e) => { delete cache[key]; throw e; });
  }
  return cache[key];
}

export async function getHand() {
  if (!cache.hand) {
    cache.hand = (async () => {
      const { mod, fileset } = await vision();
      return create(mod.HandLandmarker, fileset, {
        baseOptions: { modelAssetPath: MODELS.hand },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
    })().catch((e) => { delete cache.hand; throw e; });
  }
  return cache.hand;
}

function nextTs(lm) {
  const t = Math.max((lastTs.get(lm) || 0) + 1, Math.round(performance.now()));
  lastTs.set(lm, t);
  return t;
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const flat = (pts, third) => pts.flatMap((p) => [r4(p.x), r4(p.y), r4(third === 'visibility' ? (p.visibility ?? 1) : p.z)]);

export function detectPose(lm, source) {
  const r = lm.detectForVideo(source, nextTs(lm));
  if (!r || !r.landmarks || !r.landmarks.length || !r.worldLandmarks || !r.worldLandmarks.length) return null;
  return { i: flat(r.landmarks[0], 'visibility'), w: flat(r.worldLandmarks[0]) };
}

export function detectHand(lm, source) {
  const r = lm.detectForVideo(source, nextTs(lm));
  if (!r || !r.landmarks || !r.landmarks.length || !r.worldLandmarks || !r.worldLandmarks.length) return null;
  return { i: flat(r.landmarks[0]), w: flat(r.worldLandmarks[0]) };
}

// ───────── 影片處理 ─────────
export function once(el, ev, ms = 4000) {
  return new Promise((res) => {
    const done = () => { clearTimeout(to); el.removeEventListener(ev, done); res(); };
    const to = setTimeout(done, ms);
    el.addEventListener(ev, done);
  });
}

export function seek(video, t) {
  return new Promise((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return res();
    const done = () => { clearTimeout(to); video.removeEventListener('seeked', done); res(); };
    const to = setTimeout(done, 2500);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// MediaRecorder 錄的 webm 常沒有影片長度，需要先跳到尾端讓瀏覽器算出來
export async function ensureReady(video) {
  if (video.readyState < 1) await once(video, 'loadedmetadata', 8000);
  try { await video.play(); video.pause(); } catch { /* iOS 需要先播放一次才能正確跳轉 */ }
  if (!(isFinite(video.duration) && video.duration > 0)) {
    await new Promise((res) => {
      const done = () => {
        if (isFinite(video.duration)) { cleanup(); res(); }
      };
      const cleanup = () => { clearTimeout(to); video.removeEventListener('durationchange', done); video.removeEventListener('timeupdate', done); };
      const to = setTimeout(() => { cleanup(); res(); }, 4000);
      video.addEventListener('durationchange', done);
      video.addEventListener('timeupdate', done);
      video.currentTime = 1e7;
    });
  }
  await seek(video, 0);
  if (video.readyState < 2) await once(video, 'loadeddata', 3000);
  return video.duration;
}

export async function extractPose(video, { start = 0, end, fps = 30, quality = 'full', onFrame, isCancelled } = {}) {
  const lm = await getPose(quality);
  const frames = [];
  const total = Math.max(1, Math.floor((end - start) * fps) + 1);
  for (let k = 0; k < total; k++) {
    if (isCancelled && isCancelled()) throw new Error('cancelled');
    const t = Math.min(end, start + k / fps);
    await seek(video, t);
    let r = null;
    try { r = detectPose(lm, video); } catch (e) { console.warn(e); }
    if (r) frames.push({ t: r4(t), ...r });
    if (onFrame) onFrame(k + 1, total, r);
    if (k % 5 === 4) await new Promise((res) => setTimeout(res, 0));
  }
  return frames;
}

export function snapshot(video, maxW = 480, q = 0.78) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(1, maxW / vw);
  const c = document.createElement('canvas');
  c.width = Math.round(vw * s); c.height = Math.round(vh * s);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

// ───────── 相機與錄影 ─────────
export async function openCamera(video, facing = 'user') {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no-media'), { name: 'NotSupportedError' });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  if (video.readyState < 2) await once(video, 'loadeddata', 5000);
  return stream;
}

export function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return list.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
}

export function cameraErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '沒有相機權限。請在瀏覽器網址列旁的設定中允許使用相機，再重新整理。';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '找不到可用的相機。請改用「上傳影片」。';
  if (n === 'NotReadableError') return '相機正被其他 App 使用，請先關閉後再試。';
  if (n === 'NotSupportedError') return '這個瀏覽器不支援相機，或網頁不是用 https 開啟。請改用「上傳影片」。';
  return '無法開啟相機：' + (e && e.message ? e.message : '未知錯誤');
}
