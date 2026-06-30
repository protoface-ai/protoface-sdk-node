import type { ProtofaceTransport, ProtofaceTransportConnectOptions } from ".";
import type { ProtofaceConnection } from "../types";

export const LIVEKIT_AUDIO_STREAM_TOPIC = "lk.audio_stream";
export const LIVEKIT_CLEAR_BUFFER_RPC = "lk.clear_buffer";
export const DEFAULT_AVATAR_IDENTITY = "protoface-avatar-agent";
export const PROTOFACE_AUDIO_SAMPLE_RATE = 16_000;
export const PROTOFACE_AUDIO_CHANNELS = 1;

interface LiveKitRoomLike {
  localParticipant?: {
    streamBytes?: (options?: Record<string, unknown>) => Promise<LiveKitByteStreamWriter>;
    performRpc?: (params: {
      destinationIdentity: string;
      method: string;
      payload: string;
    }) => Promise<string>;
  };
  on?: (event: unknown, listener: (...args: unknown[]) => void) => unknown;
  connect?: (url: string, token: string) => Promise<void>;
  disconnect?: () => Promise<void> | void;
}

interface LiveKitByteStreamWriter {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

export interface LiveKitProtofaceTransportOptions {
  roomFactory?: () => LiveKitRoomLike | Promise<LiveKitRoomLike>;
}

export class LiveKitProtofaceTransport implements ProtofaceTransport {
  private room: LiveKitRoomLike | null = null;
  private audioTopic = LIVEKIT_AUDIO_STREAM_TOPIC;
  private controlMethod = LIVEKIT_CLEAR_BUFFER_RPC;
  private avatarIdentity = DEFAULT_AVATAR_IDENTITY;
  private audioWriterPromise: Promise<LiveKitByteStreamWriter> | null = null;

  constructor(private readonly options: LiveKitProtofaceTransportOptions = {}) {}

  async connect(options: ProtofaceTransportConnectOptions): Promise<void> {
    this.audioTopic = options.audioTopic || LIVEKIT_AUDIO_STREAM_TOPIC;
    this.controlMethod = options.controlTopic || LIVEKIT_CLEAR_BUFFER_RPC;
    const connection = requireLiveKitConnection(options.connection);
    this.avatarIdentity = connection.avatarIdentity || DEFAULT_AVATAR_IDENTITY;

    const livekit = await import("livekit-client");
    const room = this.options.roomFactory
      ? await this.options.roomFactory()
      : (new livekit.Room() as LiveKitRoomLike);
    this.room = room;

    room.on?.(livekit.RoomEvent.TrackSubscribed, (track: unknown) => {
      attachRemoteTrack(track, options.videoElement, options.audioElement);
    });

    await room.connect?.(connection.livekitUrl, connection.participantToken);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    await this.closeAudioWriter();
    await room?.disconnect?.();
  }

  async sendAudioData(data: Uint8Array): Promise<void> {
    const writer = await this.getAudioWriter();
    try {
      await writer.write(data);
    } catch (error) {
      this.audioWriterPromise = null;
      try {
        await writer.close();
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
  }

  async sendControlMessage(type: string): Promise<void> {
    const participant = this.room?.localParticipant;
    if (!participant?.performRpc) {
      throw new Error("LiveKit room is not connected.");
    }
    const method = type === "clear_buffer" ? LIVEKIT_CLEAR_BUFFER_RPC : this.controlMethod;
    await participant.performRpc({
      destinationIdentity: this.avatarIdentity,
      method,
      payload: ""
    });
  }

  private getAudioWriter(): Promise<LiveKitByteStreamWriter> {
    if (!this.audioWriterPromise) {
      const participant = this.room?.localParticipant;
      if (!participant?.streamBytes) {
        throw new Error("LiveKit room is not connected.");
      }
      let writerPromise: Promise<LiveKitByteStreamWriter>;
      writerPromise = participant.streamBytes({
        topic: this.audioTopic,
        attributes: {
          sample_rate: String(PROTOFACE_AUDIO_SAMPLE_RATE),
          num_channels: String(PROTOFACE_AUDIO_CHANNELS)
        },
        destinationIdentities: [this.avatarIdentity],
        mimeType: "audio/pcm"
      }).catch((error) => {
        if (this.audioWriterPromise === writerPromise) {
          this.audioWriterPromise = null;
        }
        throw error;
      });
      this.audioWriterPromise = writerPromise;
    }
    return this.audioWriterPromise;
  }

  private async closeAudioWriter(): Promise<void> {
    const writerPromise = this.audioWriterPromise;
    this.audioWriterPromise = null;
    if (!writerPromise) {
      return;
    }
    let writer: LiveKitByteStreamWriter;
    try {
      writer = await writerPromise;
    } catch {
      return;
    }
    await writer.close();
  }
}

function requireLiveKitConnection(connection: ProtofaceConnection | undefined): ProtofaceConnection {
  if (!connection) {
    throw new Error("LiveKitProtofaceTransport requires a LiveKit connection.");
  }
  return connection;
}

function attachRemoteTrack(
  track: unknown,
  videoElement?: HTMLVideoElement | null,
  audioElement?: HTMLAudioElement | null
): void {
  const remoteTrack = track as {
    kind?: string;
    attach?: (element?: HTMLMediaElement) => HTMLMediaElement;
  };

  if (remoteTrack.kind === "video" && videoElement) {
    remoteTrack.attach?.(videoElement);
    return;
  }

  if (remoteTrack.kind === "audio" && audioElement) {
    remoteTrack.attach?.(audioElement);
  }
}
