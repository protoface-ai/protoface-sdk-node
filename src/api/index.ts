import { DEFAULT_AVATAR_IDENTITY } from "../transport/livekit";
import type {
  CreateLiveKitSessionRequest,
  ProtofaceApiClientOptions,
  ProtofaceApiLike,
  ProtofaceSession
} from "../types";

const DEFAULT_API_BASE_URL = "https://api.protoface.com";

export class ProtofaceApiClient implements ProtofaceApiLike {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProtofaceApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation is available.");
    }
  }

  async createLiveKitSession(request: CreateLiveKitSessionRequest): Promise<ProtofaceSession> {
    const body: Record<string, unknown> = {
      avatar_id: request.avatarId,
      transport: {
        type: "livekit",
        url: request.livekitUrl,
        room_name: request.roomName,
        worker_token: request.workerToken,
        worker_identity: request.workerIdentity ?? DEFAULT_AVATAR_IDENTITY,
        audio_source: "data_stream"
      }
    };
    if (request.quality) {
      body.quality = request.quality;
    }
    if (request.maxDurationSeconds !== undefined) {
      body.max_duration_seconds = request.maxDurationSeconds;
    }
    if (request.idleTimeoutSeconds !== undefined) {
      body.idle_timeout_seconds = request.idleTimeoutSeconds;
    }
    if (request.metadata) {
      body.metadata = request.metadata;
    }

    return this.request<ProtofaceSession>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request<unknown>(`/v1/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: "POST"
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
    };
    if (typeof payload.error?.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.error?.code === "string") {
      return payload.error.code;
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Fall through.
  }
  return `Protoface API request failed with HTTP ${response.status}.`;
}
