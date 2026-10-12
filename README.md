# Earshot

A read-aloud e-reader for your own EPUB and PDF books. It works offline once it's installed on your phone.

**Open it:** https://wronski8248.github.io/earshot/

On iPhone, open the link in Safari, tap **Share → Add to Home Screen**, and use it from the home screen icon.

## What it does
- Opens EPUB, PDF and TXT files. Your books stay on your phone and are never uploaded.
- Highlights each sentence as it's read, and remembers your spot in every book.
- **Apple voices:** start instantly, with Westeros-style accent presets.
- **Natural AI voice:** [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), an open-source AI voice that runs on the phone. One-time download of about 92 MB. It keeps reading with the screen locked, and the lock screen shows play and pause controls. **Prepare ahead** makes 30 minutes to 2 hours of audio in advance and saves it on the phone, so it plays instantly, even offline.

## Open-source parts
- Kokoro-82M voice model (Apache 2.0), run with [kokoro-js](https://github.com/hexgrad/kokoro) (Apache 2.0), transformers.js 4 (Apache 2.0) and ONNX Runtime Web (MIT); see the LICENSE files
- PDF.js (Apache 2.0) and JSZip (MIT)
- Literata, Bricolage Grotesque and IBM Plex Mono fonts (SIL Open Font License)
