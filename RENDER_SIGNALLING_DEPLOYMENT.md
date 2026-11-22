# Reality Engine — Static HF + Render signalling

This deployment profile keeps the browser application on the Hugging Face Static Space and runs only the room-aware WebSocket relay on Render.

## Render service

The repository includes a `render.yaml` Blueprint for a Node web service.

- Build command: `npm ci`
- Start command: `npm run start:render-signalling`
- Health check: `/health`
- WebSocket endpoint: `wss://<render-service>.onrender.com/signal`

Create a Blueprint from this repository and select branch `deployment/static-hf-render-backend`. Render should detect `render.yaml`. Keep the service root at the repository root.

After deployment, verify:

- `https://<render-service>.onrender.com/health` returns HTTP 200 and JSON with `status: "ok"`.
- The WebSocket endpoint is `wss://<render-service>.onrender.com/signal`.

The Render service is a signalling relay only. It does not host the Vite frontend, the Python scientific solver, API keys, or simulation state.

## Hugging Face Static Space

Set the Space variable `VITE_SIGNAL_URL` to the full public WebSocket URL, including the path:

```text
wss://<render-service>.onrender.com/signal
```

Then rebuild/restart the Static Space so Vite embeds the variable into the browser bundle. This URL is public configuration, not a secret.

Do not set `VITE_SIGNAL_URL` to an `https://` URL. It must use `wss://` in production (or `ws://` for local development).

If the variable is absent in a production Static Space, multiplayer continues to use the same-browser `BroadcastChannel` path and does not attempt a broken same-origin WebSocket connection.

## Local development

Without `VITE_SIGNAL_URL`, Vite development mode uses the same-origin `/signal` endpoint. Run the existing combined local HTTP/WebSocket server when testing this path. To test the external endpoint resolver, use:

```powershell
npm run test:signalling-endpoint
npm run test:render-signalling
```

## Service limitations

A free Render web service may spin down after inactivity. The first connection after a spin-down can therefore be delayed while the service starts. The relay is transient: it forwards messages between connected peers and does not persist rooms or world state. The current implementation has room-token isolation and sender-identity binding, but room tokens are not user authentication and the relay is not an encrypted application-level trust boundary.
