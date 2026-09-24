# Reality Engine — CPU Edition

This branch is prepared for a CPU-first Hugging Face deployment.

## Deployment model

The Space metadata uses:

- SDK: `static`
- App file: `dist/index.html`

Static Spaces avoid a persistent Docker/Gradio runtime and therefore avoid the CPU Basic runtime quota for the hosted application. Hugging Face documents Static Spaces separately from compute-backed Docker and Gradio Spaces.

## Build

```bash
npm ci
npm run build
npm run hf:cpu:check
```

The generated `dist/` directory is the deployable artifact.

## Runtime model

The simulation runs in the visitor's browser. CPU execution is the baseline path. WebGPU/WebGL features remain optional browser capabilities; the Space does not require a GPU-backed server.

## Scope

This CPU edition is intended to provide the Reality Engine browser simulator without requiring a Docker process or server-side signalling process. Multiplayer/signalling remains a separate server-backed capability.
