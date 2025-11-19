# Electron (Chromium) Desktop App

This project now includes a minimal Electron wrapper and FFmpeg integration for merging videos.

Prerequisites: Node.js

1. Install dependencies:

```bash
npm install
```

2. Run the app in development (runs Vite + Electron):

```bash
npm run electron:dev
```

3. From renderer, use the exposed API `window.electronAPI.mergeVideos(inputs, outputPath)` to invoke FFmpeg merging.

Notes:
- FFmpeg binary is provided by `ffmpeg-static` and is executed from the Electron main process.
- The current merge implementation uses the `concat` demuxer; for incompatible codecs, a re-encode approach may be needed.
