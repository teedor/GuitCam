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
