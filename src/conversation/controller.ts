import { asConversationError, ProtofaceConversationError } from "./errors";
import {
  createBoundedJpegBlob,
  decodeDataPayload,
  encodeJson,
  inferTranscriptRole,
  isAttachableTrack,
  isReadableVideoFrame,
  sanitizeEventPayload,
  uint8ToBase64
} from "./media";
import { buildState, freezeState, INITIAL_PERMISSIONS, setupPermission } from "./state";
import type {
  ConversationResponse,
  LiveKitRoom,
  ManagedConversationConfig,
  ManagedConversationControllerOptions,
  ManagedConversationEventMap,
  ManagedConversationEventName,
  ManagedConversationListener,
  ManagedConversationPermissions,
  ManagedConversationState,
  ManagedConversationStatus,
  SetupResponse,
  ToolCallEvent
} from "./types";
import { parseRetryAfter, validateConfig, validateConversationResponse, validateSetupResponse } from "./validation";

const DEFAULT_API_BASE_URL = "https://api.protoface.com";
const VISION_TOPIC = "protoface.embed.vision-frame";
const VISION_INTERVAL_MS = 5_000;
const VISION_MAX_EDGE = 512;
const VISION_MAX_BYTES = 96 * 1024;
const VISION_JPEG_QUALITIES = [0.72, 0.62, 0.52, 0.42];

export class ManagedConversationController {
  readonly embedId: string;
  readonly apiBaseUrl: string;

  private readonly fetchImpl: typeof fetch;
  private readonly listeners: {
    [EventName in ManagedConversationEventName]?: Set<ManagedConversationListener<EventName>>;
  } = {};

  private currentState: ManagedConversationState = buildState("loading", {
    config: null,
    consent: null,
    permissions: INITIAL_PERMISSIONS,
    microphoneEnabled: true,
    computerVisionEnabled: false,
    error: null
  });

  private consentAccepted = false;
  private readonly computerVisionRequested: boolean;
  private setupToken: string | null = null;
  private roomName: string | null = null;
  private conversationId: string | undefined;
  private expiresAt: string | null = null;
  private room: LiveKitRoom | null = null;
  private localMicStream: MediaStream | null = null;
  private visionStream: MediaStream | null = null;
  private visionVideo: HTMLVideoElement | null = null;
  private visionTimer: ReturnType<typeof setInterval> | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private remoteVideoTrack: { attach?: (element?: HTMLMediaElement) => unknown; detach?: (element?: HTMLMediaElement) => unknown } | null = null;
  private remoteAudioTrack: { attach?: (element?: HTMLMediaElement) => unknown; detach?: (element?: HTMLMediaElement) => unknown } | null = null;
  private endedEmitted = false;
  private started = false;
  private lifecycleVersion = 0;
  private avatarReadyFrameVersion = 0;

  constructor(options: ManagedConversationControllerOptions) {
    if (!options.embedId || typeof options.embedId !== "string") {
      throw new ProtofaceConversationError({
        code: "invalid_options",
        message: "ManagedConversationController requires an embedId."
      });
    }

    this.embedId = options.embedId;
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.computerVisionRequested = options.computerVisionEnabled !== false;
    const fetchCandidate = options.fetch ?? globalThis.fetch;
    if (typeof fetchCandidate !== "function") {
      throw new ProtofaceConversationError({
        code: "fetch_unavailable",
        message: "ManagedConversationController requires a fetch implementation."
      });
    }
    this.fetchImpl = options.fetch ?? fetchCandidate.bind(globalThis);
  }

  get state(): ManagedConversationState {
    return this.currentState;
  }

  on<EventName extends ManagedConversationEventName>(
    event: EventName,
    listener: ManagedConversationListener<EventName>
  ): () => void {
    const listeners = (this.listeners[event] as Set<ManagedConversationListener<EventName>> | undefined) ?? new Set();
    (this.listeners as Record<ManagedConversationEventName, Set<unknown> | undefined>)[event] = listeners as Set<unknown>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  setMediaElements(elements: { videoElement?: HTMLVideoElement | null; audioElement?: HTMLAudioElement | null }): void {
    this.detachRemoteMedia();
    this.videoElement = elements.videoElement ?? null;
    this.audioElement = elements.audioElement ?? null;
    this.attachRemoteMedia();
  }

  async load(): Promise<void> {
    const version = ++this.lifecycleVersion;
    this.resetForLoad();
    this.setStatus("loading");
    let config: ManagedConversationConfig;
    try {
      config = await this.requestJson<ManagedConversationConfig>(
        `/api/v1/embed/${encodeURIComponent(this.embedId)}/config`,
        { method: "GET" },
        validateConfig
      );
    } catch (error) {
      if (!this.isCurrentLifecycle(version)) return;
      throw this.fail(asConversationError(error));
    }
    if (!this.isCurrentLifecycle(version)) return;

    if (!config.enabled) {
      throw this.fail(
        new ProtofaceConversationError({
          code: "embed_disabled",
          message: "This Protoface conversation is not enabled."
        })
      );
    }

    this.updateState({
      config,
      consent: config.consent,
      permissions: { ...INITIAL_PERMISSIONS, computer_vision: this.shouldRequestComputerVision(config) ? "unknown" : "not_requested" }
    });
    this.setStatus("device_access_required");
  }

  async requestPermissions(): Promise<void> {
    const config = this.requireConfig();
    const version = this.lifecycleVersion;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw this.fail(
        new ProtofaceConversationError({
          code: "media_devices_unavailable",
          message: "This browser does not expose media device access."
        })
      );
    }

    this.setStatus("requesting_device_access");
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.isCurrentLifecycle(version)) {
        this.stopStream(micStream);
        return;
      }
      this.localMicStream = micStream;
      this.updatePermissions({ microphone: "granted" });
      this.emit("device_access_changed", { permissions: this.state.permissions, state: this.state });
    } catch (cause) {
      if (!this.isCurrentLifecycle(version)) return;
      this.updatePermissions({ microphone: "denied" });
      this.emit("device_access_changed", { permissions: this.state.permissions, state: this.state });
      throw this.fail(
        new ProtofaceConversationError({
          code: "device_access_denied",
          message: "Microphone device access is required before this conversation can begin.",
          cause
        })
      );
    }

    if (this.shouldRequestComputerVision(config)) {
      try {
        const visionStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }
        });
        if (!this.isCurrentLifecycle(version)) {
          this.stopStream(visionStream);
          return;
        }
        this.visionStream = visionStream;
        this.updatePermissions({ computer_vision: "granted" });
      } catch {
        if (!this.isCurrentLifecycle(version)) return;
        this.updatePermissions({ computer_vision: "denied" });
      }
      this.emit("device_access_changed", { permissions: this.state.permissions, state: this.state });
    }

    if (config.consent.enabled) {
      this.setStatus("consent_required");
      return;
    }

    this.setStatus("confirming_consent");
    await this.createSetup(config, version, false);
  }

  async acceptConsent(): Promise<void> {
    const config = this.requireConfig();
    const version = this.lifecycleVersion;
    if (this.state.permissions.microphone !== "granted") {
      throw this.fail(
        new ProtofaceConversationError({
          code: "invalid_state",
          message: "Device access must be checked before accepting the privacy acknowledgement."
        })
      );
    }

    if (!config.consent.enabled) {
      throw this.fail(
        new ProtofaceConversationError({
          code: "invalid_state",
          message: "The privacy acknowledgement is not enabled for this conversation."
        })
      );
    }

    this.setStatus("confirming_consent");
    await this.createSetup(config, version, true);
  }

  private async createSetup(config: ManagedConversationConfig, version: number, consentAccepted: boolean): Promise<void> {
    const permissions = {
      microphone: setupPermission(this.state.permissions.microphone),
      computer_vision: setupPermission(this.state.permissions.computer_vision)
    };
    const body: Record<string, unknown> = { permissions };
    if (consentAccepted) {
      body.consent = { version: config.consent.version, accepted: true };
    }

    let setup: SetupResponse;
    try {
      setup = await this.requestJson<SetupResponse>(
        `/api/v1/embed/${encodeURIComponent(this.embedId)}/setup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        },
        validateSetupResponse
      );
    } catch (error) {
      if (!this.isCurrentLifecycle(version)) return;
      throw this.fail(asConversationError(error));
    }
    if (!this.isCurrentLifecycle(version)) return;
    this.setupToken = setup.setup_token;
    this.consentAccepted = consentAccepted;
    this.updateState({ consent: config.consent });
    if (consentAccepted) {
      this.emit("consent_changed", { consent: config.consent, accepted: true, state: this.state });
    }
    this.setStatus("ready_to_begin");
    this.emit("ready_to_begin", { state: this.state });
  }

  async start(): Promise<void> {
    const token = this.setupToken;
    const version = this.lifecycleVersion;
    if (!token) {
      throw this.fail(
        new ProtofaceConversationError({
          code: "invalid_state",
          message: "A ready-to-begin conversation is required before start."
        })
      );
    }

    this.setupToken = null;
    this.setStatus("joining");
    let conversation: ConversationResponse;
    try {
      conversation = await this.requestJson<ConversationResponse>(
        `/api/v1/embed/${encodeURIComponent(this.embedId)}/conversations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            setup_token: token,
            permissions: {
              microphone: setupPermission(this.state.permissions.microphone),
              computer_vision: setupPermission(this.state.permissions.computer_vision)
            }
          })
        },
        validateConversationResponse
      );
    } catch (error) {
      if (!this.isCurrentLifecycle(version)) return;
      throw this.fail(asConversationError(error));
    }
    if (!this.isCurrentLifecycle(version)) return;

    this.roomName = conversation.room;
    this.conversationId = conversation.conversation_id;
    this.expiresAt = conversation.expires_at;
    this.updateState({ computerVisionEnabled: conversation.computer_vision_enabled && this.state.permissions.computer_vision === "granted" });
    this.emit("computer_vision_changed", { enabled: this.state.computerVisionEnabled, state: this.state });

    try {
      const room = await this.connectLiveKit(conversation);
      this.room = room;
      await this.publishMicrophone(room);
      if (this.state.computerVisionEnabled) {
        this.startVisionFrames(room);
      }
      if (!this.isCurrentLifecycle(version)) {
        void room.disconnect();
        return;
      }
    } catch (cause) {
      throw this.fail(
        new ProtofaceConversationError({
          code: "connection_failed",
          message: "Protoface conversation failed to connect.",
          cause
        })
      );
    }

    this.started = true;
    this.setStatus("waiting_for_avatar");
    this.markAvatarReadyWhenFrameReadable();
    this.emit("started", {
      conversationId: this.conversationId,
      room: conversation.room,
      expiresAt: conversation.expires_at,
      state: this.state
    });
  }

  async end(): Promise<void> {
    if (this.state.ending || this.state.ended) {
      this.emitEndedOnce("ended");
      return;
    }
    this.lifecycleVersion += 1;
    this.setStatus("ending");
    const roomName = this.roomName;
    this.cleanupMedia();
    if (roomName) {
      await this.stopConversation(roomName);
    }
    this.setStatus("ended");
    this.emitEndedOnce("ended");
  }

  async restart(): Promise<void> {
    await this.end();
    this.endedEmitted = false;
    this.started = false;
    this.setupToken = null;
    this.roomName = null;
    this.conversationId = undefined;
    this.expiresAt = null;
    this.consentAccepted = false;
    await this.load();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.updateState({ microphoneEnabled: enabled });
    for (const track of this.localMicStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
    this.emit("microphone_changed", { enabled, state: this.state });
  }

  async toggleMicrophone(): Promise<void> {
    await this.setMicrophoneEnabled(!this.state.microphoneEnabled);
  }

  private async connectLiveKit(conversation: ConversationResponse): Promise<LiveKitRoom> {
    const livekit = await import("livekit-client");
    const room = new livekit.Room() as LiveKitRoom;
    const roomEvent = livekit.RoomEvent ?? {};
    room.on(roomEvent.TrackSubscribed ?? "trackSubscribed", (track: unknown) => this.handleRemoteTrack(track));
    room.on(roomEvent.DataReceived ?? "dataReceived", (payload: unknown, participant: unknown, kindOrTopic: unknown, topicMaybe: unknown) =>
      this.handleDataReceived(payload, participant, kindOrTopic, topicMaybe)
    );
    room.on(roomEvent.TranscriptionReceived ?? "transcriptionReceived", (segments: unknown, participant: unknown) =>
      this.handleTranscriptionReceived(segments, participant)
    );
    room.on(roomEvent.Disconnected ?? "disconnected", () => {
      if (this.started && !this.state.ending && !this.state.ended && !this.state.failed) {
        void this.end();
      }
    });
    await room.connect(conversation.livekit_url, conversation.token);
    return room;
  }

  private async publishMicrophone(room: LiveKitRoom): Promise<void> {
    const tracks = this.localMicStream?.getAudioTracks() ?? [];
    await Promise.all(
      tracks.map((track) => {
        track.enabled = this.state.microphoneEnabled;
        return room.localParticipant.publishTrack(track, { source: "microphone" });
      })
    );
  }

  private handleRemoteTrack(track: unknown): void {
    if (!isAttachableTrack(track)) return;
    const mediaStreamTrack = "mediaStreamTrack" in track ? (track.mediaStreamTrack as MediaStreamTrack | undefined) : undefined;
    const kind = mediaStreamTrack?.kind ?? (track as { kind?: string }).kind;
    if (kind === "audio") {
      this.remoteAudioTrack = track;
    } else {
      this.remoteVideoTrack = track;
    }
    this.attachRemoteMedia();
    this.markAvatarReadyWhenFrameReadable();
  }

  private markAvatarReadyWhenFrameReadable(): void {
    if (!this.state.waiting_for_avatar || !this.remoteVideoTrack || !this.videoElement) return;

    const version = ++this.avatarReadyFrameVersion;
    const markReady = () => {
      if (version !== this.avatarReadyFrameVersion || !this.state.waiting_for_avatar || !isReadableVideoFrame(this.videoElement)) return;
      this.setStatus("live");
      this.emit("avatar_ready", { state: this.state });
    };

    if (isReadableVideoFrame(this.videoElement)) {
      markReady();
      return;
    }

    const video = this.videoElement;
    let settled = false;
    const cleanup = () => {
      settled = true;
      video.removeEventListener("loadeddata", onReadable);
      video.removeEventListener("canplay", onReadable);
    };
    const onReadable = () => {
      if (settled) return;
      cleanup();
      markReady();
    };

    video.addEventListener("loadeddata", onReadable, { once: true });
    video.addEventListener("canplay", onReadable, { once: true });
    video.requestVideoFrameCallback?.(() => onReadable());
  }

  private handleTranscriptionReceived(segments: unknown, participant: unknown): void {
    if (!Array.isArray(segments)) return;
    const role = inferTranscriptRole(participant);
    for (const segment of segments) {
      if (!segment || typeof segment !== "object") continue;
      const record = segment as Record<string, unknown>;
      const content = typeof record.text === "string" ? record.text.trim() : typeof record.content === "string" ? record.content.trim() : "";
      if (!content) continue;
      this.emit("transcript", {
        id: typeof record.id === "string" ? record.id : undefined,
        room: this.roomName ?? undefined,
        role,
        content,
        final: record.final === true
      });
    }
  }

  private handleDataReceived(payload: unknown, _participant: unknown, kindOrTopic: unknown, topicMaybe: unknown): void {
    const topic = typeof topicMaybe === "string" ? topicMaybe : typeof kindOrTopic === "string" ? kindOrTopic : undefined;
    const data = decodeDataPayload(payload);
    if (!data) return;
    const sanitized = sanitizeEventPayload(data);
    const type = typeof sanitized.type === "string" ? sanitized.type : "";
    const event = typeof sanitized.event === "string" ? sanitized.event : "";
    const classifier = `${topic ?? ""} ${type} ${event}`;
    if (/tool/i.test(classifier)) {
      this.emit("tool_call", sanitized as ToolCallEvent);
    }
  }

  private attachRemoteMedia(): void {
    if (this.videoElement && this.remoteVideoTrack?.attach) {
      this.remoteVideoTrack.attach(this.videoElement);
      this.videoElement.playsInline = true;
      this.videoElement.autoplay = true;
      this.markAvatarReadyWhenFrameReadable();
    }
    if (this.audioElement && this.remoteAudioTrack?.attach) {
      this.remoteAudioTrack.attach(this.audioElement);
      this.audioElement.autoplay = true;
    }
  }

  private detachRemoteMedia(): void {
    if (this.videoElement && this.remoteVideoTrack?.detach) {
      this.remoteVideoTrack.detach(this.videoElement);
    }
    if (this.audioElement && this.remoteAudioTrack?.detach) {
      this.remoteAudioTrack.detach(this.audioElement);
    }
  }

  private startVisionFrames(room: LiveKitRoom): void {
    if (!this.visionStream) return;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.visionStream;
    this.visionVideo = video;
    void video.play?.().catch(() => undefined);
    this.visionTimer = setInterval(() => {
      void this.publishVisionFrame(room).catch((cause) => {
        this.emit("error", {
          error: new ProtofaceConversationError({
            code: "connection_failed",
            message: "Unable to publish a computer vision frame.",
            cause
          }),
          state: this.state
        });
      });
    }, VISION_INTERVAL_MS);
  }

  private async publishVisionFrame(room: LiveKitRoom): Promise<void> {
    const video = this.visionVideo;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = Math.min(1, VISION_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await createBoundedJpegBlob(canvas, VISION_JPEG_QUALITIES, VISION_MAX_BYTES);
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const frameId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const envelope = {
      type: "vision_frame",
      frame_id: frameId,
      captured_at: new Date().toISOString(),
      mime_type: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
      byte_length: bytes.byteLength,
      data: uint8ToBase64(bytes)
    };
    await room.localParticipant.publishData(encodeJson(envelope), { reliable: true, topic: VISION_TOPIC });
  }

  private cleanupMedia(): void {
    this.avatarReadyFrameVersion += 1;
    if (this.visionTimer) {
      clearInterval(this.visionTimer);
      this.visionTimer = null;
    }
    if (this.visionVideo) {
      this.visionVideo.pause?.();
      this.visionVideo.srcObject = null;
      this.visionVideo = null;
    }
    this.detachRemoteMedia();
    this.remoteVideoTrack = null;
    this.remoteAudioTrack = null;
    this.stopStream(this.localMicStream);
    this.stopStream(this.visionStream);
    this.localMicStream = null;
    this.visionStream = null;
    if (this.room) {
      void this.room.disconnect();
      this.room = null;
    }
  }

  private async stopConversation(roomName: string): Promise<void> {
    try {
      await this.fetchImpl(this.url(`/api/v1/embed/${encodeURIComponent(this.embedId)}/conversations/${encodeURIComponent(roomName)}/stop`), {
        method: "POST",
        mode: "no-cors",
        keepalive: true
      });
    } catch {
      // Best-effort browser cleanup path; backend room expiry remains authoritative.
    }
  }

  private stopStream(stream: MediaStream | null): void {
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    validate: (value: unknown) => T
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.headers ?? {})
        }
      });
    } catch (cause) {
      throw new ProtofaceConversationError({
        code: "network_error",
        message: "Protoface conversation request failed before receiving a response.",
        cause
      });
    }

    if (!response.ok) {
      const apiError = await readConversationApiError(response);
      throw new ProtofaceConversationError({
        code: "http_error",
        message: conversationHttpErrorMessage(response.status, apiError),
        status: response.status,
        retryAfter: parseRetryAfter(response.headers.get("retry-after")),
        apiErrorType: apiError?.type,
        apiErrorCode: apiError?.code,
        requestId: apiError?.requestId
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new ProtofaceConversationError({
        code: "invalid_response",
        message: "Protoface conversation response was not valid JSON.",
        cause
      });
    }

    try {
      return validate(json);
    } catch (cause) {
      throw new ProtofaceConversationError({
        code: "invalid_response",
        message: "Protoface conversation response did not match the expected schema.",
        cause
      });
    }
  }

  private url(path: string): string {
    return `${this.apiBaseUrl}${path}`;
  }

  private requireConfig(): ManagedConversationConfig {
    if (!this.state.config) {
      throw new ProtofaceConversationError({
        code: "invalid_state",
        message: "load() must complete before this method can be used."
      });
    }
    return this.state.config;
  }

  private shouldRequestComputerVision(config: ManagedConversationConfig | null): boolean {
    return this.computerVisionRequested && config?.computer_vision_enabled === true;
  }

  private resetForLoad(): void {
    this.cleanupMedia();
    this.endedEmitted = false;
    this.started = false;
    this.setupToken = null;
    this.roomName = null;
    this.conversationId = undefined;
    this.expiresAt = null;
    this.consentAccepted = false;
    this.updateState({
      permissions: INITIAL_PERMISSIONS,
      computerVisionEnabled: false,
      error: null
    });
  }

  private updatePermissions(update: Partial<ManagedConversationPermissions>): void {
    this.updateState({ permissions: { ...this.state.permissions, ...update } });
  }

  private updateState(update: Partial<Omit<ManagedConversationState, ManagedConversationStatus>> & Partial<ManagedConversationState>): void {
    this.currentState = freezeState({ ...this.currentState, ...update });
  }

  private setStatus(status: ManagedConversationStatus): void {
    this.currentState = buildState(status, this.currentState);
    this.emit("status_changed", { status, state: this.state });
  }

  private fail(error: ProtofaceConversationError): ProtofaceConversationError {
    this.lifecycleVersion += 1;
    this.cleanupMedia();
    this.updateState({ error });
    this.setStatus("failed");
    this.emit("error", { error, state: this.state });
    this.emitEndedOnce("failed");
    return error;
  }

  private isCurrentLifecycle(version: number): boolean {
    return version === this.lifecycleVersion && !this.state.ending && !this.state.ended && !this.state.failed;
  }

  private emitEndedOnce(reason?: string): void {
    if (this.endedEmitted) return;
    this.endedEmitted = true;
    this.emit("ended", { reason, state: this.state });
  }

  private emit<EventName extends ManagedConversationEventName>(
    event: EventName,
    payload: ManagedConversationEventMap[EventName]
  ): void {
    for (const listener of this.listeners[event] ?? []) {
      (listener as ManagedConversationListener<EventName>)(payload);
    }
  }
}

function normalizeApiBaseUrl(apiBaseUrl?: string): string {
  const baseUrl = apiBaseUrl?.trim() || DEFAULT_API_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

type ConversationApiError = {
  type?: string;
  code?: string;
  message?: string;
  requestId?: string;
};

async function readConversationApiError(response: Response): Promise<ConversationApiError | null> {
  try {
    const payload = (await response.json()) as {
      error?: {
        type?: unknown;
        code?: unknown;
        message?: unknown;
        request_id?: unknown;
      };
      message?: unknown;
    };
    return {
      type: typeof payload.error?.type === "string" ? payload.error.type : undefined,
      code: typeof payload.error?.code === "string" ? payload.error.code : undefined,
      message:
        typeof payload.error?.message === "string"
          ? payload.error.message
          : typeof payload.message === "string"
            ? payload.message
            : undefined,
      requestId: typeof payload.error?.request_id === "string" ? payload.error.request_id : undefined
    };
  } catch {
    return null;
  }
}

function conversationHttpErrorMessage(status: number, apiError: ConversationApiError | null): string {
  if (apiError?.message) return apiError.message;
  if (status === 429) return "Too many conversations are starting right now. Please wait a moment and try again.";
  if (status >= 500) return "Protoface conversations are temporarily unavailable. Please try again later.";
  return "This conversation could not be started. Please check the embed settings and try again.";
}
