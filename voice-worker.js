// Earshot AI voice engine. Runs the open-source Kokoro model on the phone, off the main page.
import { KokoroTTS, env } from "./kokoro.web.js";

env.wasmPaths = new URL("./", self.location.href).href;
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts = null;
let queue = [];
let busy = false;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function load({ dtype, device }) {
  const files = {};
  let announced = false;
  const progress_callback = (p) => {
    if (p.status === "done" && !announced) {
      const all = Object.values(files);
      if (all.length && all.every(f => f.loaded >= f.total)) { announced = true; post({ type: "stage", stage: "starting" }); }
    }
    if (p.status === "progress" && p.total) {
      files[p.file] = { loaded: p.loaded, total: p.total };
      let loaded = 0, total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
      post({ type: "progress", loaded, total });
    }
  };
  const t0 = performance.now();
  try {
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device, progress_callback });
  } catch (e) {
    if (device === "webgpu") {
      post({ type: "note", message: "The graphics chip mode didn't start, so Earshot is using standard mode." });
      tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback });
      device = "wasm";
    } else throw e;
  }
  // warm up so the first real sentence starts quickly
  post({ type: "stage", stage: "testing" });
  await tts.generate("Ready.", { voice: "bf_emma" });
  post({ type: "ready", device, threads: self.crossOriginIsolated ? "multi" : "single", ms: Math.round(performance.now() - t0) });
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const t0 = performance.now();
      const audio = await tts.generate(job.text, { voice: job.voice, speed: job.speed || 1 });
      const pcm = toInt16(audio.audio);
      post({ type: "audio", id: job.id, pcm, rate: audio.sampling_rate, ms: Math.round(performance.now() - t0) }, [pcm.buffer]);
    } catch (e) {
      post({ type: "error", id: job.id, message: String(e && e.message || e) });
    }
  }
  busy = false;
}

self.addEventListener("unhandledrejection", (e) => {
  post({ type: "fail", message: String(e.reason && e.reason.message || e.reason) });
});

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "load") {
    try { await load(m); } catch (err) { post({ type: "fail", message: String(err && err.message || err) }); }
  } else if (m.type === "gen") {
    queue.push(m); pump();
  } else if (m.type === "cancel") {
    queue = [];
  }
};
