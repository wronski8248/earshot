// Shared MP3 helper for Earshot (lamejs encoder + exact durations from frame headers).
import { Mp3Encoder } from "./mp3-encoder.js";

// Each piece is saved as a small MP3 (48 kbps, about 22 MB per hour), with its pause built in.
export const BR = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
export function toMp3(pcm, rate) {
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

