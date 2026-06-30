import { describe, expect, it, vi } from "vitest";

import { ProtofaceClient } from "../src/client";
import type { ProtofaceTransport } from "../src/transport";
import type { ProtofaceApiLike, ProtofaceClientOptions } from "../src/types";

class MemoryTransport implements ProtofaceTransport {
  connected = false;
  audio: Uint8Array[] = [];
  controls: string[] = [];

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async sendAudioData(data: Uint8Array) {
    this.audio.push(data);
  }

  async sendControlMessage(type: string) {
    this.controls.push(type);
  }
}

function makeApiClient(): ProtofaceApiLike {
  return {
    createLiveKitSession: async (request) => ({
      id: "sess_123",
      status: "queued",
      avatar_id: request.avatarId,
      transport: {
        type: "livekit",
        url: request.livekitUrl,
        room_name: request.roomName,
        audio_source: "data_stream",
        worker_identity: request.workerIdentity
      },
      quality: "standard",
      max_duration_seconds: 600,
      idle_timeout_seconds: 30,
      metadata: {},
      created_at: "2026-06-25T18:00:00.000Z"
    }),
    endSession: async () => {}
  };
}

function makeOptions(
  transport: ProtofaceTransport,
  overrides: Partial<ProtofaceClientOptions> = {}
): ProtofaceClientOptions {
  return {
    apiKey: "sk_live_test",
    avatarId: "av_stock_001",
    livekitUrl: "wss://livekit.example",
    roomName: "room-1",
    participantToken: "viewer.jwt",
    workerToken: "worker.jwt",
    apiClient: makeApiClient(),
    transportFactory: () => transport,
    ...overrides
  };
}

describe("ProtofaceClient", () => {
  it("starts once, emits lifecycle events, sends audio, clears buffer, and stops", async () => {
    const transport = new MemoryTransport();
    const client = new ProtofaceClient(makeOptions(transport));
    const seen: string[] = [];
    client.on("start", (event) => seen.push(`start:${event.sessionId}`));
    client.on("stop", () => seen.push("stop"));

    await client.start();
    await client.sendAudioData(new Uint8Array([1, 2, 3]));
    await client.clearBuffer();
    await client.close();

    expect(seen).toEqual(["start:sess_123", "stop"]);
    expect(transport.audio).toEqual([new Uint8Array([1, 2, 3])]);
    expect(transport.controls).toEqual(["clear_buffer"]);
    expect(client.status).toBe("stopped");
  });

  it("rejects audio before start and duplicate starts", async () => {
    const client = new ProtofaceClient(makeOptions(new MemoryTransport()));

    await expect(client.sendAudioData(new Uint8Array([1]))).rejects.toThrow(/not started/i);
    await client.start();
    await expect(client.start()).rejects.toThrow(/already started/i);
  });

  it("forwards media-track chunks from the configured audio source", async () => {
    const transport = new MemoryTransport();
    const stop = vi.fn();
    const client = new ProtofaceClient(makeOptions(transport, {
      audioSourceFactory: () => ({
        listenToMediaStreamTrack: async (_track, onChunk) => {
          await onChunk(new Uint8Array([9, 8, 7]));
          return stop;
        }
      })
    }));

    await client.start();
    const cleanup = await client.listenToMediastreamTrack({} as MediaStreamTrack);

    expect(transport.audio).toEqual([new Uint8Array([9, 8, 7])]);
    cleanup();
    expect(stop).toHaveBeenCalled();
  });

  it("supports ClearBuffer alias", async () => {
    const transport = new MemoryTransport();
    const client = new ProtofaceClient(makeOptions(transport));

    await client.start();
    await client.ClearBuffer();

    expect(transport.controls).toEqual(["clear_buffer"]);
  });

  it("starts with a custom transport without requiring LiveKit connection fields", async () => {
    const transport = new MemoryTransport();
    const client = new ProtofaceClient({
      transportFactory: () => transport
    });
    const seen: string[] = [];
    client.on("start", (event) => seen.push(event.roomName ?? "custom"));

    await client.start();
    await client.sendAudioData(new Uint8Array([4, 5, 6]));
    await client.stop();

    expect(seen).toEqual(["custom"]);
    expect(transport.audio).toEqual([new Uint8Array([4, 5, 6])]);
    expect(transport.connected).toBe(false);
  });

  it("creates and ends a Protoface API session when configured with API credentials", async () => {
    const transport = new MemoryTransport();
    const created: string[] = [];
    const ended: string[] = [];
    const client = new ProtofaceClient({
      apiKey: "sk_live_test",
      avatarId: "av_stock_001",
      livekitUrl: "wss://lk.example",
      roomName: "room-1",
      participantToken: "viewer.jwt",
      workerToken: "worker.jwt",
      transportFactory: () => transport,
      apiClient: {
        createLiveKitSession: async (request) => {
          created.push(request.workerToken);
          return {
            id: "sess_created",
            status: "queued",
            avatar_id: request.avatarId,
            transport: {
              type: "livekit",
              url: request.livekitUrl,
              room_name: request.roomName,
              audio_source: "data_stream",
              worker_identity: request.workerIdentity
            },
            quality: "standard",
            max_duration_seconds: 600,
            idle_timeout_seconds: 30,
            metadata: {},
            created_at: "2026-06-25T18:00:00.000Z"
          };
        },
        endSession: async (sessionId) => {
          ended.push(sessionId);
        }
      }
    });

    await client.start();
    await client.stop();

    expect(created).toEqual(["worker.jwt"]);
    expect(ended).toEqual(["sess_created"]);
    expect(transport.connected).toBe(false);
  });
});
