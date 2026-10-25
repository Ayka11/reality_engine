# Hugging Face Docker Space deployment contract

This document describes the repository-root Docker Space configuration; it is not a certification that Reality Engine is production-ready as a scientific instrument.

## Deployment files

- `README.md` — current root Space metadata (`sdk: docker`) and product documentation
- `Dockerfile` and `Dockerfile.hf` — Node 20 Docker images using the committed npm lockfile
- `server/hf-server.js` — HTTP runtime served on port `7860`
- `scripts/hf-smoke-check.mjs` — deployment package consistency check

## Local validation

```bash
npm ci --legacy-peer-deps
npm run lint
npm run build
npm run hf:smoke
npm run hf:cpu:check
npm run hf:browser:acceptance
docker build --file Dockerfile.hf --tag reality-engine-hf:local .
```

CI also builds both Docker images and smoke-tests the Hugging Face container.

## Separate Static Space profile

`README_HF.md` and `HF_CPU_DEPLOYMENT.md` describe a separate browser-first Static Space profile (`sdk: static`, `app_file: dist/index.html`). Do not mix the Static Space metadata with the Docker metadata at the repository root.
