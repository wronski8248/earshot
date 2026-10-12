// Earshot AI voice engine. Runs the open-source Kokoro model on the phone, off the main page.
import "./safari-fixes.js"; // must load first
import { KokoroTTS, env } from "./kokoro-engine.js";
import { Mp3Encoder } from "./mp3-encoder.js";

const T0 = performance.now();
const sec = () => ((performance.now() - T0) / 1000).toFixed(1) + "s";
function log(msg) { self.postMessage({ type: "log", msg: sec() + "  " + msg }); }
log("engine code loaded: transformers.js " + env.version + (self.__earshotPatched ? " (Safari patch applied)" : ""));
let beat = setInterval(() => self.postMessage({ type: "tick" }), 2000);

// Run the engine from this site's own copy of ONNX Runtime (CPU build: the most dependable one on iPhone).
const here = new URL("./", self.location.href).href;
env.backends.onnx.wasm.wasmPaths = { mjs: here + "ort-wasm-simd-threaded.mjs", wasm: here + "ort-wasm-simd-threaded.wasm" };
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts = null;
let queue = [];
let busy = false;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function load({ dtype, device }) {
  const files = {};
  let announced = false;
  const progress_callback = (p) => {
    if (p.status === "initiate") log("fetching " + p.file);
    if (p.status === "done") log("got " + p.file);
    if (p.status === "ready") log("model files ready");
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
  log("starting: " + dtype + " on " + device + ", threads: " + (self.crossOriginIsolated ? "multi" : "single"));
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device, progress_callback });
  // warm up so the first real sentence starts quickly
  log("voice engine created");
  post({ type: "stage", stage: "testing" });
  log("test sentence: starting");
  const w = await tts.generate("Ready.", { voice: "bf_emma" });
  log("test sentence: done (" + (w.audio.length / w.sampling_rate).toFixed(1) + "s of audio)");
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

// Each piece is saved as a small MP3 (48 kbps, about 22 MB per hour), with its pause built in.
const BR = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function toMp3(pcm, rate) {
  const enc = new Mp3Encoder(1, rate, 48);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) { const b = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (b.length) parts.push(b); }
  const end = enc.flush(); if (end.length) parts.push(end);
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  // exact playing time, read from the MP3 frame headers (keeps the highlighting in sync)
  let samples = 0, pos = 0;
  while (pos + 4 <= out.length) {
    if (out[pos] !== 0xFF || (out[pos + 1] & 0xE0) !== 0xE0) { pos++; continue; }
    const ver = (out[pos + 1] >> 3) & 3, mpeg1 = ver === 3;
    const br = (mpeg1 ? BR1 : BR)[(out[pos + 2] >> 4) & 15], sr = (SR[ver] || [])[(out[pos + 2] >> 2) & 3], pad = (out[pos + 2] >> 1) & 1;
    if (!br || !sr) { pos++; continue; }
    const spf = mpeg1 ? 1152 : 576;
    samples += spf; pos += Math.floor(spf / 8 * br * 1000 / sr) + pad;
  }
  return { mp3: out, dur: samples / rate };
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const t0 = performance.now();
      const audio = await tts.generate(job.text, { voice: job.voice, speed: job.speed || 1 });
      const rate = audio.sampling_rate, gap = Math.round((job.gap || 0) * rate);
      const pcm = new Int16Array(audio.audio.length + gap);
      pcm.set(toInt16(audio.audio));
      const { mp3, dur } = toMp3(pcm, rate);
      post({ type: "audio", id: job.id, mp3, dur, speech: audio.audio.length / rate, ms: Math.round(performance.now() - t0) }, [mp3.buffer]);
    } catch (e) {
      post({ type: "error", id: job.id, message: String(e && e.message || e) });
    }
  }
  busy = false;
}

self.addEventListener("error", (e) => {
  post({ type: "fail", message: String(e.message || e) });
});
self.addEventListener("unhandledrejection", (e) => {
  post({ type: "fail", message: String(e.reason && e.reason.message || e.reason) });
});

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "load") {
    try { await load(m); } catch (err) { log("error: " + String(err && err.stack || err).slice(0, 300)); post({ type: "fail", message: String(err && err.message || err) }); }
  } else if (m.type === "gen") {
    queue.push(m); pump();
  } else if (m.type === "cancel") {
    queue = [];
  }
};
