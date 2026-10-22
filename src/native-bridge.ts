export interface BridgeRequest { channel: string; id: string; path: string; method: 'GET' | 'POST'; data?: unknown }
/** A fresh opaque-origin frame cannot address the parent DOM or make network requests. */
export function bridgeRequest(value: unknown, channel: string): BridgeRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !['channel', 'id', 'path', 'method', 'data'].includes(k)) || r.channel !== channel
    || typeof r.id !== 'string' || !/^[0-9a-f-]{36}$/.test(r.id) || typeof r.path !== 'string' || r.path.length > 250
    || !['GET', 'POST'].includes(String(r.method)) || JSON.stringify(r).length > 32768) return null;
  return r as unknown as BridgeRequest;
}
