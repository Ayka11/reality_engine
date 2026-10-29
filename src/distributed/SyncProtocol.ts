import type { SyncMessage } from './types';

export const SyncProtocol = {
  serialize(msg: SyncMessage): string {
    // ArrayBuffer cannot be JSON-serialized; if present, mark as empty placeholder
    try { return JSON.stringify(msg); } catch { return JSON.stringify({ type: 'ping', ts: Date.now() }); }
  },
  parse(raw: string): SyncMessage | null {
    try { return JSON.parse(raw) as SyncMessage; } catch { return null; }
  }
};
