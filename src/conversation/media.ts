const TOKEN_FIELD_NAMES = new Set([
  "token",
  "setup_token",
  "setuptoken",
  "viewer_token",
  "viewertoken",
  "participanttoken",
  "participant_token",
  "workertoken",
  "worker_token",
  "apikey",
  "api_key",
  "authorization"
]);

export function isReadableVideoFrame(video: HTMLVideoElement | null): boolean {
  return !!video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

export function isAttachableTrack(value: unknown): value is {
  attach?: (element?: HTMLMediaElement) => unknown;
  detach?: (element?: HTMLMediaElement) => unknown;
  mediaStreamTrack?: MediaStreamTrack;
  kind?: string;
} {
  return !!value && typeof value === "object" && typeof (value as { attach?: unknown }).attach === "function";
}

export function decodeDataPayload(payload: unknown): Record<string, unknown> | null {
  let text: string;
  if (typeof payload === "string") {
    text = payload;
  } else if (ArrayBuffer.isView(payload)) {
    text = new TextDecoder().decode(payload as ArrayBufferView);
  } else if (payload instanceof ArrayBuffer) {
    text = new TextDecoder().decode(payload);
  } else {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function inferTranscriptRole(participant: unknown): "user" | "agent" {
  if (!participant || typeof participant !== "object") return "agent";
  const record = participant as Record<string, unknown>;
  if (record.isLocal === true) return "user";
  const identity = typeof record.identity === "string" ? record.identity : "";
  const name = typeof record.name === "string" ? record.name : "";
  return /(^|[-_\s])(user|human|viewer|participant)([-_\s]|$)/i.test(`${identity} ${name}`) ? "user" : "agent";
}

export function sanitizeEventPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeEventPayload(item)) as T;
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (TOKEN_FIELD_NAMES.has(key.toLowerCase())) continue;
    output[key] = sanitizeEventPayload(child);
  }
  return output as T;
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export async function createBoundedJpegBlob(canvas: HTMLCanvasElement, qualities: readonly number[], maxBytes: number): Promise<Blob | null> {
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= maxBytes) return blob;
  }
  return null;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
