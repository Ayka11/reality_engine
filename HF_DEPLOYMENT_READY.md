# Hugging Face Spaces Deployment Ready

Target branch: `codex/kernel-foundation`

## Deployment files

- `README_HF.md` — Space metadata and deployment contract
- `Dockerfile.hf` — Node 20 Docker image, production Vite build, port 7860
- `scripts/hf-smoke-check.mjs` — deployment package consistency check
- `package.json` — `npm run hf:smoke`

## Build contract

```bash
npm ci
npm run build
npm run hf:smoke
```

The hosted Space should expose the built frontend on port 7860. Optional scientific solver dependencies are not included in the core HF image.
