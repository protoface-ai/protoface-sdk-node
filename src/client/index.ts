import { WebAudioPcmSource } from "../audio";
import type { StopListening } from "../audio";
import { ProtofaceApiClient } from "../api";
import { TypedEventEmitter } from "../events";
import { ProtofaceClientError } from "../errors";
import type { ProtofaceTransport } from "../transport";
import {
  LIVEKIT_AUDIO_STREAM_TOPIC,
  LIVEKIT_CLEAR_BUFFER_RPC,
  LiveKitProtofaceTransport
} from "../transport/livekit";
import { LogLevel } from "../types";
import type {
  ProtofaceClientEvents,
  ProtofaceClientOptions,
  ProtofaceClientStatus,
  ProtofaceConnection,
  Unsubscribe
} from "../types";

const DEFAULT_AUDIO_TOPIC = LIVEKIT_AUDIO_STREAM_TOPIC;
const DEFAULT_CONTROL_TOPIC = LIVEKIT_CLEAR_BUFFER_RPC;

export class ProtofaceClient {
  private readonly emitter = new TypedEventEmitter<ProtofaceClientEvents>();
  private readonly options: Required<
    Pick<ProtofaceClientOptions, "logLevel" | "audioTopic" | "controlTopic">
  > &
    Omit<ProtofaceClientOptions, "logLevel" | "audioTopic" | "controlTopic">;
  private transport: ProtofaceTransport | null = null;
  private mediaTrackCleanups = new Set<StopListening>();
  private currentStatus: ProtofaceClientStatus = "idle";
  private activeSessionId: string | null = null;
  private ownsProtofaceSession = false;

  constructor(options: ProtofaceClientOptions) {
    this.options = {
      ...options,
      logLevel: options.logLevel ?? LogLevel.INFO,
      audioTopic: options.audioTopic ?? DEFAULT_AUDIO_TOPIC,
      controlTopic: options.controlTopic ?? DEFAULT_CONTROL_TOPIC
    };
  }

  get status(): ProtofaceClientStatus {
    return this.currentStatus;
  }

  on<TKey extends keyof ProtofaceClientEvents>(
    event: TKey,
    listener: (payload: ProtofaceClientEvents[TKey]) => void
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  setMediaElements(options: {
    videoElement?: HTMLVideoElement | null;
    audioElement?: HTMLAudioElement | null;
  }): void {
    this.options.videoElement = options.videoElement;
    this.options.audioElement = options.audioElement;
  }

  async start(): Promise<void> {
    if (this.currentStatus === "started" || this.currentStatus === "starting") {
      throw new ProtofaceClientError("ProtofaceClient is already started.");
    }

    this.currentStatus = "starting";
    this.transport = this.options.transportFactory?.() ?? new LiveKitProtofaceTransport();

    try {
      const connection = await this.resolveConnection();
      await this.transport.connect({
        connection,
        videoElement: this.options.videoElement,
        audioElement: this.options.audioElement,
        audioTopic: this.options.audioTopic,
        controlTopic: this.options.controlTopic
      });
      this.currentStatus = "started";
      if (connection) {
        this.emitter.emit("connection_info", {
          roomName: connection.roomName,
          livekitUrl: connection.livekitUrl
        });
      }
      this.emitter.emit("start", {
        sessionId: connection?.sessionId,
        roomName: connection?.roomName
      });
    } catch (error) {
      const normalized = normalizeError(error);
      this.currentStatus = "error";
      this.emitter.emit("startup_error", { message: normalized.message });
      this.emitter.emit("error", { error: normalized });
      throw normalized;
    }
  }

  async stop(): Promise<void> {
    if (this.currentStatus !== "started" && this.currentStatus !== "error") {
      this.currentStatus = "stopped";
      return;
    }

    this.currentStatus = "stopping";
    const sessionId = this.activeSessionId ?? undefined;
    for (const cleanup of this.mediaTrackCleanups) {
      cleanup();
    }
    this.mediaTrackCleanups.clear();
    await this.transport?.disconnect();
    this.transport = null;
    if (sessionId && this.ownsProtofaceSession) {
      await this.getApiClient().endSession(sessionId);
      this.ownsProtofaceSession = false;
    }
    this.activeSessionId = null;
    this.currentStatus = "stopped";
    this.emitter.emit("stop", { sessionId });
  }

  async close(): Promise<void> {
    await this.stop();
  }

  async sendAudioData(audioData: Uint8Array): Promise<void> {
    const transport = this.requireStarted();
    await transport.sendAudioData(audioData);
    this.emitter.emit("ack", { bytes: audioData.byteLength });
  }

  async listenToMediaStreamTrack(track: MediaStreamTrack): Promise<StopListening> {
    this.requireStarted();
    const source = this.options.audioSourceFactory?.() ?? new WebAudioPcmSource();
    const cleanup = await source.listenToMediaStreamTrack(track, async (chunk) => {
      await this.sendAudioData(chunk);
    });
    const wrappedCleanup = () => {
      cleanup();
      this.mediaTrackCleanups.delete(wrappedCleanup);
    };
    this.mediaTrackCleanups.add(wrappedCleanup);
    return wrappedCleanup;
  }

  async listenToMediastreamTrack(track: MediaStreamTrack): Promise<StopListening> {
    return this.listenToMediaStreamTrack(track);
  }

  async clearBuffer(): Promise<void> {
    const transport = this.requireStarted();
    await transport.sendControlMessage("clear_buffer");
    this.emitter.emit("silent", undefined);
  }

  async ClearBuffer(): Promise<void> {
    await this.clearBuffer();
  }

  private requireStarted(): ProtofaceTransport {
    if (this.currentStatus !== "started" || !this.transport) {
      throw new ProtofaceClientError("ProtofaceClient is not started.");
    }
    return this.transport;
  }

  private async resolveConnection(): Promise<ProtofaceConnection | undefined> {
    if (!this.requiresLiveKitConnection()) {
      return undefined;
    }

    const avatarId = requireOption("avatarId", this.options.avatarId);
    const livekitUrl = requireOption("livekitUrl", this.options.livekitUrl);
    const roomName = requireOption("roomName", this.options.roomName);
    const participantToken = requireOption("participantToken", this.options.participantToken);
    const workerToken = requireOption("workerToken", this.options.workerToken);

    const session = await this.getApiClient().createLiveKitSession({
      avatarId,
      livekitUrl,
      roomName,
      workerToken,
      workerIdentity: this.options.workerIdentity,
      quality: this.options.quality,
      maxDurationSeconds: this.options.maxDurationSeconds,
      idleTimeoutSeconds: this.options.idleTimeoutSeconds,
      metadata: this.options.metadata
    });
    this.activeSessionId = session.id;
    this.ownsProtofaceSession = true;
    return {
      livekitUrl,
      roomName,
      participantToken,
      sessionId: session.id,
      avatarId,
      avatarIdentity: this.options.workerIdentity
    };
  }

  private requiresLiveKitConnection(): boolean {
    return !this.options.transportFactory || hasLiveKitConnectionOptions(this.options);
  }

  private getApiClient() {
    if (this.options.apiClient) {
      return this.options.apiClient;
    }
    if (!this.options.apiKey) {
      throw new ProtofaceClientError(
        "ProtofaceClient requires apiKey or apiClient to create a Protoface session."
      );
    }
    return new ProtofaceApiClient({
      apiKey: this.options.apiKey,
      baseUrl: this.options.apiUrl
    });
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireOption(name: string, value: string | undefined): string {
  if (!value) {
    throw new ProtofaceClientError(`ProtofaceClient requires ${name} to start a session.`);
  }
  return value;
}

function hasLiveKitConnectionOptions(options: ProtofaceClientOptions): boolean {
  return Boolean(
    options.livekitUrl ||
      options.roomName ||
      options.participantToken ||
      options.workerToken ||
      options.apiKey ||
      options.apiClient
  );
}
