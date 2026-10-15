// Used inside the Earshot iPhone app: turns audio from the native voice engine into small MP3 pieces.
import { toMp3 } from "./mp3-tools.js";

self.onmessage = (e) => {
  const { id, pcm, rate, gap, ms } = e.data;
  const pad = Math.round((gap || 0) * rate);
  const full = new Int16Array(pcm.length + pad);
  full.set(pcm);
  const { mp3, dur } = toMp3(full, rate);
  self.postMessage({ type: "audio", id, mp3, dur, speech: pcm.length / rate, ms }, [mp3.buffer]);
};
