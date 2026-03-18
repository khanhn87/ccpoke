const MAX_CALLBACK_BYTES = 64;

export interface TargetCallback {
  paneId: string;
  panePid: string;
}

export function buildTargetCallback(prefix: string, paneId: string, panePid: string): string {
  const raw = `${prefix}:${paneId}:${panePid}`;
  if (Buffer.byteLength(raw, "utf-8") <= MAX_CALLBACK_BYTES) return raw;

  const overhead = Buffer.byteLength(prefix, "utf-8") + 1 + 1 + Buffer.byteLength(panePid, "utf-8");
  const maxTargetLen = MAX_CALLBACK_BYTES - overhead;
  const parts = paneId.split(":");
  const suffix = parts.length > 1 ? `:${parts.slice(1).join(":")}` : "";
  const sessionName = parts[0]!;
  const maxSessionLen = maxTargetLen - suffix.length;
  const truncated = sessionName.slice(0, Math.max(4, maxSessionLen));
  return `${prefix}:${truncated}${suffix}:${panePid}`;
}

export function parseTargetCallback(data: string, prefix: string): TargetCallback | null {
  if (!data.startsWith(prefix + ":")) return null;
  const rest = data.slice(prefix.length + 1);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) return null;

  const panePid = rest.slice(lastColon + 1);
  const paneId = rest.slice(0, lastColon);

  if (!/^\d+$/.test(panePid) || !paneId) return null;
  return { paneId, panePid };
}
