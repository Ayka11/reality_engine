---
title: Reality Engine Meta Law Simulator
emoji: 🌌
colorFrom: blue
colorTo: purple
sdk: static
app_file: dist/index.html
app_build_command: npm run build
fullWidth: true
header: mini
license: mit
pinned: false
custom_headers:
  cross-origin-embedder-policy: require-corp
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---

# Reality Engine — Hugging Face Static Space

This branch targets a browser-first Hugging Face Static Space.

## Deployment target

- SDK: Static
- Build command: `npm run build`
- Published entry point: `dist/index.html`
- Runtime server: none
- Frontend: Vite + Three.js
- Core Infinite World and Science Lab workflows run in the browser.
- Optional signalling/solver services are not required for the core Static Space.

## Build locally

```bash
npm ci
npm run build
npm run hf:smoke
npm run hf:cpu:check
```

## Static runtime contract

```text
Hugging Face Static Space
        ↓
     dist/index.html
        ↓
   Vite browser bundle
        ↓
Infinite World + Science Lab
```

The Static Space does not require a Node runtime, port 7860, or the internal WebSocket signalling process.

## WebGPU

The application uses browser APIs where available and browser-side CPU paths where supported. A GPU-enabled Hugging Face runtime is not required to serve the static bundle.

## Scientific solver service

Optional solver/service components remain outside the core Static Space contract. The hosted browser application must not claim those optional capabilities are available unless a separate service is configured.

## Acceptance

A successful Static deployment should:

1. Serve `dist/index.html`.
2. Load all relative Vite assets.
3. Render the Infinite World viewport in-browser.
4. Keep World Tools and sidebars detachable without blocking the viewport.
5. Execute Quick Generate and the Science Lab workflow in the browser.
