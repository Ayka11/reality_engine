const ROOM_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

export function buildSignallingUrl(
  configuredUrl: string | undefined,
  roomId: string,
  pageUrl: string,
  isDevelopment: boolean,
): string | null {
  if (!ROOM_PATTERN.test(roomId)) return null;

  let endpoint: URL;
  const configured = configuredUrl?.trim();

  try {
    if (configured) {
      endpoint = new URL(configured);
      if (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') return null;
      if (endpoint.pathname !== '/signal' || endpoint.username || endpoint.password || endpoint.hash) return null;
    } else {
      if (!isDevelopment) return null;
      const page = new URL(pageUrl);
      endpoint = new URL('/signal', page.origin);
      endpoint.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
    }
  } catch {
    return null;
  }

  endpoint.searchParams.set('room', roomId);
  return endpoint.toString();
}

export function getConfiguredSignallingUrl(
  viteConfiguredUrl: string | undefined,
  runtimeConfiguredUrl: string | undefined,
): string | undefined {
  const runtime = runtimeConfiguredUrl?.trim();
  if (runtime) return runtime;
  const vite = viteConfiguredUrl?.trim();
  return vite || undefined;
}
