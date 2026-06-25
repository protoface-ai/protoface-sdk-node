import type { ProtofaceConnection } from "../types";

export interface ProtofaceTransportConnectOptions {
  connection?: ProtofaceConnection;
  videoElement?: HTMLVideoElement | null;
  audioElement?: HTMLAudioElement | null;
  audioTopic: string;
  controlTopic: string;
}

export interface ProtofaceTransport {
  connect(options: ProtofaceTransportConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  sendAudioData(data: Uint8Array): Promise<void>;
  sendControlMessage(type: string, payload?: Record<string, unknown>): Promise<void>;
}

export type ProtofaceTransportFactory = () => ProtofaceTransport;
