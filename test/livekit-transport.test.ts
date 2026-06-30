import { describe, expect, it } from "vitest";

import {
  LIVEKIT_AUDIO_STREAM_TOPIC,
  LIVEKIT_CLEAR_BUFFER_RPC,
  LiveKitProtofaceTransport
} from "../src/transport/livekit";
import type { ProtofaceConnection } from "../src/types";

class FakeWriter {
  chunks: Uint8Array[] = [];
  closed = false;

  async write(chunk: Uint8Array) {
    this.chunks.push(chunk);
  }

  async close() {
    this.closed = true;
  }
}

class FakeLocalParticipant {
  streams: Array<{ options: Record<string, unknown>; writer: FakeWriter }> = [];
  rpcs: Array<Record<string, unknown>> = [];
  streamFailures = 0;

  async streamBytes(options?: Record<string, unknown>) {
    if (this.streamFailures > 0) {
      this.streamFailures -= 1;
      throw new Error("stream failed");
    }
    const writer = new FakeWriter();
    this.streams.push({ options: options ?? {}, writer });
    return writer;
  }

  async performRpc(params: Record<string, unknown>) {
    this.rpcs.push(params);
    return "ok";
  }
}

class FakeRoom {
  localParticipant = new FakeLocalParticipant();
  connectedWith: Array<{ url: string; token: string }> = [];
  disconnected = false;

  on() {
    return this;
  }

  async connect(url: string, token: string) {
    this.connectedWith.push({ url, token });
  }

  async disconnect() {
    this.disconnected = true;
  }
}

const connection: ProtofaceConnection = {
  livekitUrl: "wss://livekit.example",
  roomName: "room-1",
  participantToken: "viewer.jwt",
  sessionId: "sess_123",
  avatarIdentity: "protoface-avatar-agent"
};

describe("LiveKitProtofaceTransport", () => {
  it("reuses one LiveKit byte stream for PCM chunks until disconnect", async () => {
    const room = new FakeRoom();
    const transport = new LiveKitProtofaceTransport({ roomFactory: () => room });
    const firstChunk = new Uint8Array([1, 2, 3]);
    const secondChunk = new Uint8Array([4, 5, 6]);

    await transport.connect({
      connection,
      videoElement: null,
      audioElement: null,
      audioTopic: LIVEKIT_AUDIO_STREAM_TOPIC,
      controlTopic: LIVEKIT_CLEAR_BUFFER_RPC
    });
    await transport.sendAudioData(firstChunk);
    await transport.sendAudioData(secondChunk);

    expect(room.connectedWith).toEqual([
      { url: "wss://livekit.example", token: "viewer.jwt" }
    ]);
    expect(room.localParticipant.streams).toHaveLength(1);
    expect(room.localParticipant.streams[0]?.options).toEqual({
      topic: LIVEKIT_AUDIO_STREAM_TOPIC,
      attributes: { sample_rate: "16000", num_channels: "1" },
      destinationIdentities: ["protoface-avatar-agent"],
      mimeType: "audio/pcm"
    });
    expect(room.localParticipant.streams[0]?.writer.chunks).toEqual([firstChunk, secondChunk]);
    expect(room.localParticipant.streams[0]?.writer.closed).toBe(false);

    await transport.disconnect();

    expect(room.localParticipant.streams[0]?.writer.closed).toBe(true);
  });

  it("calls Protoface's clear-buffer RPC on the avatar participant", async () => {
    const room = new FakeRoom();
    const transport = new LiveKitProtofaceTransport({ roomFactory: () => room });

    await transport.connect({
      connection,
      videoElement: null,
      audioElement: null,
      audioTopic: LIVEKIT_AUDIO_STREAM_TOPIC,
      controlTopic: LIVEKIT_CLEAR_BUFFER_RPC
    });
    await transport.sendControlMessage("clear_buffer");

    expect(room.localParticipant.rpcs).toEqual([
      {
        destinationIdentity: "protoface-avatar-agent",
        method: LIVEKIT_CLEAR_BUFFER_RPC,
        payload: ""
      }
    ]);
  });

  it("opens a new byte stream after stream creation fails", async () => {
    const room = new FakeRoom();
    room.localParticipant.streamFailures = 1;
    const transport = new LiveKitProtofaceTransport({ roomFactory: () => room });
    const chunk = new Uint8Array([1, 2, 3]);

    await transport.connect({
      connection,
      videoElement: null,
      audioElement: null,
      audioTopic: LIVEKIT_AUDIO_STREAM_TOPIC,
      controlTopic: LIVEKIT_CLEAR_BUFFER_RPC
    });

    await expect(transport.sendAudioData(chunk)).rejects.toThrow("stream failed");
    await transport.sendAudioData(chunk);

    expect(room.localParticipant.streams).toHaveLength(1);
    expect(room.localParticipant.streams[0]?.writer.chunks).toEqual([chunk]);
  });
});
