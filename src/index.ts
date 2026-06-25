export { ProtofaceClient } from "./client";
export { ProtofaceApiClient } from "./api";
export { WebAudioPcmSource, float32ToPcm16 } from "./audio";
export {
  DEFAULT_AVATAR_IDENTITY,
  LIVEKIT_AUDIO_STREAM_TOPIC,
  LIVEKIT_CLEAR_BUFFER_RPC,
  LiveKitProtofaceTransport,
  PROTOFACE_AUDIO_CHANNELS,
  PROTOFACE_AUDIO_SAMPLE_RATE
} from "./transport/livekit";
export type { LiveKitProtofaceTransportOptions } from "./transport/livekit";
export { TypedEventEmitter } from "./events";
export { ProtofaceClientError, ProtofaceTokenError } from "./errors";
export { LogLevel } from "./types";
export type {
  AudioSource,
  AudioSourceFactory,
  StopListening,
  WebAudioPcmSourceOptions
} from "./audio";
export type {
  ProtofaceTransport,
  ProtofaceTransportConnectOptions,
  ProtofaceTransportFactory
} from "./transport";
export type {
  CreateLiveKitSessionRequest,
  ProtofaceApiClientOptions,
  ProtofaceApiLike,
  ProtofaceClientEvents,
  ProtofaceClientOptions,
  ProtofaceClientStatus,
  ProtofaceEventName,
  ProtofaceSessionRequest,
  ProtofaceSession,
  ProtofaceConnection,
  ProtofaceSessionStatus,
  ProtofaceLiveKitTransport,
  ProtofaceQuality,
  ProtofaceTransportMode,
  Unsubscribe
} from "./types";
