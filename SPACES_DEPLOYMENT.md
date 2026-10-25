# Hugging Face Spaces deployment guide

## Current repository target: Docker Space

The root `README.md` declares `sdk: docker`. The Docker image installs dependencies from the committed `package-lock.json`, builds the Vite frontend, and starts `server/hf-server.js` on port `7860` using `Dockerfile` or `Dockerfile.hf`.

The Space referenced by the root README is:

- Demo: https://huggingface.co/spaces/Aygun1489/Reality_Engine_SImulator

Before updating an existing Space repository, compare its current contents and metadata with this repository. Do not blindly overwrite an existing deployment or assume its slug/owner matches a local example.

## Validation before publishing

Run from the repository root:

```bash
npm ci --legacy-peer-deps
npm run lint
npm run build
npm run hf:smoke
npm run hf:cpu:check
npm run hf:browser:acceptance
docker build --file Dockerfile.hf --tag reality-engine-hf:local .
```

The GitHub Actions workflow also builds both Docker images and performs a Hugging Face container HTTP smoke test. Check the Hugging Face Space build/runtime logs after publishing.

## Static CPU-first deployment is a separate target

`README_HF.md` and `HF_CPU_DEPLOYMENT.md` describe a browser-first Static Space profile using `sdk: static` and `app_file: dist/index.html`. Use that metadata only when deploying a separate Static Space; it must not replace the root Docker Space metadata.

## Runtime limitations

- The core simulation runs in the browser; optional solver/signalling capabilities require the matching service to be deployed and configured.
- Passing build and browser tests does not establish scientific validity of simulation outputs.
- Adaptive LOD topology-changing operations remain disabled until spatial remapping and full-cell data transfer are implemented and validated.
- Keep the project marked experimental/pre-release until the open release blockers are resolved or explicitly scoped out.
