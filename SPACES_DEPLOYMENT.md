# HuggingFace Spaces Deployment Guide

This Reality Engine app is deployed as a **Docker Space** on Hugging Face.

## Setup Steps

### 1. Create a Space on HF
- Go to https://huggingface.co/new-space
- **Owner**: Your username (`Aygun1489`)
- **Space name**: `reality-engine` (or your choice)
- **License**: MIT or Apache 2.0 (recommended)
- **Space SDK**: `Docker`
- **Visibility**: Public or Private (your choice)

### 2. Clone the Space locally
```bash
git clone https://huggingface.co/spaces/Aygun1489/reality-engine
cd reality-engine
```

### 3. Copy your Reality Engine files
```bash
# From your desktop repo, copy all files into the cloned Space folder
cp -r /path/to/your/reality/* .
```

### 4. Push to HF
```bash
git add .
git commit -m "Initial Reality Engine deployment"
git push
```

HuggingFace will automatically:
- Detect the `Dockerfile`
- Build the Docker image
- Launch the Space
- Make it accessible at: `https://huggingface.co/spaces/Aygun1489/reality-engine`

## Access Your Space

Once deployed, your app runs at:
- **Main app**: `https://huggingface.co/spaces/Aygun1489/reality-engine`
- **Signalling server**: Runs internally on port 8888
- **Web server**: Runs on port 3000 (mapped by HF)

## Notes

- **WebGPU support**: Works in Chrome/Edge. Firefox falls back to CPU.
- **Multiplayer**: BroadcastChannel works within the same Space iframe.
- **GPU acceleration**: Available if your Space is upgraded to GPU (GPU spaces cost credits).
- **File uploads**: The Space has read-write access to `/tmp` if you need to save snapshots.

## Troubleshooting

If the Space doesn't start:
1. Check the **Logs** tab in the Space settings
2. Verify `Dockerfile` syntax
3. Ensure `package.json` has all required dependencies
4. Make sure `npm run build` succeeds locally first

## Next Steps

- Share the Space URL with others
- Use the **Community** tab for feedback
- Consider upgrading to **GPU Space** if you need heavy simulation

---

For more HF Spaces docs: https://huggingface.co/docs/hub/spaces
