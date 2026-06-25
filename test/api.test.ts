import { describe, expect, it, vi } from "vitest";

import { ProtofaceApiClient } from "../src/api";

describe("ProtofaceApiClient", () => {
  it("creates a LiveKit data-stream session with the public Protoface API shape", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "sess_123",
          status: "queued",
          avatar_id: "av_stock_001",
          transport: {
            type: "livekit",
            url: "wss://lk.example",
            room_name: "room-1",
            audio_source: "data_stream",
            worker_identity: "protoface-avatar-agent"
          },
          quality: "standard",
          max_duration_seconds: 600,
          idle_timeout_seconds: 30,
          metadata: {},
          created_at: "2026-06-25T18:00:00.000Z"
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    });
    const api = new ProtofaceApiClient({
      apiKey: "sk_live_test",
      baseUrl: "https://api.protoface.test",
      fetch: fetchImpl
    });

    const session = await api.createLiveKitSession({
      avatarId: "av_stock_001",
      livekitUrl: "wss://lk.example",
      roomName: "room-1",
      workerToken: "worker.jwt",
      workerIdentity: "protoface-avatar-agent",
      maxDurationSeconds: 600,
      idleTimeoutSeconds: 30
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.protoface.test/v1/sessions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer sk_live_test",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          avatar_id: "av_stock_001",
          transport: {
            type: "livekit",
            url: "wss://lk.example",
            room_name: "room-1",
            worker_token: "worker.jwt",
            worker_identity: "protoface-avatar-agent",
            audio_source: "data_stream"
          },
          max_duration_seconds: 600,
          idle_timeout_seconds: 30
        })
      })
    );
    expect(session.id).toBe("sess_123");
  });

  it("ends a session through the public API", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const api = new ProtofaceApiClient({
      apiKey: "sk_live_test",
      baseUrl: "https://api.protoface.test",
      fetch: fetchImpl
    });

    await api.endSession("sess_123");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.protoface.test/v1/sessions/sess_123/end",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer sk_live_test",
          "content-type": "application/json"
        }
      })
    );
  });
});
