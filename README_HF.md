---
title: Reality Engine Meta Law Simulator
emoji: 🌌
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
license: mit
pinned: false
---

# Reality Engine — Hugging Face Deployment

This branch provides the Docker-ready Reality Engine web application for Hugging Face Spaces.

## Deployment target

- SDK: Docker
- Port: 7860
- Runtime: Node.js 18+
- Frontend: Vite + Three.js
- Signalling server: WebSocket on `$SIGNAL_PORT` (internal process)
- Heavy scientific solvers remain optional and are not required for the core browser Space.

## Build

```bash
npm ci
npm run build
```

## Container contract

The Docker image must expose port 7860. The runtime serves the Vite production bundle from `dist/`.

```text
Browser
  ↓
HF Space :7860
  ↓
serve dist
  └── signalling-server.js → $SIGNAL_PORT (internal WebSocket)
```

## WebGPU

The application uses WebGPU-capable browser APIs where available and falls back to browser-side CPU paths where supported. A GPU-enabled HF Space is not required to launch the container.

## Scientific solver service

The Python solver under `solver/` is an auxiliary development/service component. The Docker Space does not install FEniCS/MOOSE/Elmer/GROMACS and therefore does not claim those optional capabilities are available in the hosted container.

## Health check

A successful deployment should return HTTP 200 for `/` and serve the built application.
