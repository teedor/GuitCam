# High-Fidelity Video Recorder (React + Tailwind)

Single-page, high-fidelity video recorder with:
- Live camera preview (full-screen)
- Raw microphone audio capture (no in-app processing)
- `MediaRecorder` capture with mp4→webm fallback and high bitrate attempts (>= 2.5Mbps)
- Recording timer + auto-download with timestamped filename

## Requirements
- Node.js 18+ (recommended)

## Setup
```bash
npm install
```

## Run
```bash
npm run dev
```

Then open the URL printed by Vite (typically `http://localhost:5173`).

## Install as a PWA
- In Chromium browsers (Chrome/Edge), an **Install** button will appear in the UI when the browser deems the app installable.
- If you don't see it, you can also use the browser menu: **Install app** (desktop) or **Add to Home screen** (Android).
- Note: iOS Safari doesn't support the same install prompt event; use **Share → Add to Home Screen**.
