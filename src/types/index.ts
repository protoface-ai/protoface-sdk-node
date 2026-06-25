export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4
}

export type ProtofaceClientStatus = "idle" | "starting" | "started" | "stopping" | "stopped" | "error";

export type ProtofaceTransportMode = "livekit";

export interface ProtofaceConnection {
  livekitUrl: string;
  roomName: string;
  participantToken: string;
  sessionId?: string;
  avatarId?: string;
  avatarIdentity?: string;
  expiresAt?: string;
}

export type ProtofaceSessionStatus =
  | "created"
  | "queued"
  | "starting"
  | "running"
  | "ending"
  | "ended"
  | "failed"
  | "canceled";

export type ProtofaceQuality = "standard" | "pro";

export interface ProtofaceLiveKitTransport {
  type: "livekit";
  url: string;
  room_name: string;
  audio_source?: "data_stream" | "track";
  worker_identity?: string;
}

export interface ProtofaceSession {
  id: string;
  status: ProtofaceSessionStatus;
  avatar_id: string;
  transport: ProtofaceLiveKitTransport;
  quality: string;
  max_duration_seconds: number;
  idle_timeout_seconds: number;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
}

export interface CreateLiveKitSessionRequest {
  avatarId: string;
  livekitUrl: string;
  roomName: string;
  workerToken: string;
  workerIdentity?: string;
  quality?: ProtofaceQuality | string;
  maxDurationSeconds?: number;
  idleTimeoutSeconds?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ProtofaceApiLike {
  createLiveKitSession(request: CreateLiveKitSessionRequest): Promise<ProtofaceSession>;
  endSession(sessionId: string): Promise<void>;
}

export interface ProtofaceApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ProtofaceSessionRequest {
  avatarId: string;
  faceId?: string;
  maxSessionLength?: number;
  maxIdleTime?: number;
  handleSilence?: boolean;
  voiceProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface ProtofaceClientEvents {
  start: { sessionId?: string; roomName?: string };
  stop: { sessionId?: string };
  error: { error: Error };
  speaking: undefined;
  silent: undefined;
  ack: { bytes: number };
  connection_info: { roomName?: string; livekitUrl?: string };
  video_info: { width?: number; height?: number; frameRate?: number };
  destination: { topic: string };
  unknown: { message: string };
  startup_error: { message: string };
}

export type ProtofaceEventName = keyof ProtofaceClientEvents;

export type Unsubscribe = () => void;

export interface ProtofaceClientOptions {
  apiKey?: string;
  apiUrl?: string;
  avatarId?: string;
  livekitUrl?: string;
  roomName?: string;
  participantToken?: string;
  workerToken?: string;
  workerIdentity?: string;
  quality?: ProtofaceQuality | string;
  maxDurationSeconds?: number;
  idleTimeoutSeconds?: number;
  metadata?: Record<string, string | number | boolean | null>;
  videoElement?: HTMLVideoElement | null;
  audioElement?: HTMLAudioElement | null;
  logLevel?: LogLevel;
  audioTopic?: string;
  controlTopic?: string;
  transportFactory?: import("../transport").ProtofaceTransportFactory;
  audioSourceFactory?: import("../audio").AudioSourceFactory;
  apiClient?: ProtofaceApiLike;
}
