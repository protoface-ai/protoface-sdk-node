import type { ProtofaceConversationError } from "./errors";

export type ManagedConversationStatus =
  | "loading"
  | "device_access_required"
  | "requesting_device_access"
  | "consent_required"
  | "confirming_consent"
  | "ready_to_begin"
  | "joining"
  | "waiting_for_avatar"
  | "live"
  | "ending"
  | "ended"
  | "failed";

export type PermissionState = "unknown" | "granted" | "denied" | "not_requested";
export type SetupPermissionState = "granted" | "denied" | "not_requested";

export interface ConversationConsentConfig {
  version: string;
  enabled: boolean;
  text?: string;
  computer_vision_text?: string;
  [key: string]: unknown;
}

export interface ManagedConversationConfig {
  enabled: boolean;
  avatar_name?: string;
  cta_title?: string;
  cta_description?: string;
  cta_button_label?: string;
  avatar?: unknown;
  portrait_url?: string;
  computer_vision_enabled: boolean;
  consent: ConversationConsentConfig;
  [key: string]: unknown;
}

export interface ManagedConversationPermissions {
  microphone: PermissionState;
  computer_vision: PermissionState;
}

export interface ManagedConversationState {
  status: ManagedConversationStatus;
  loading: boolean;
  device_access_required: boolean;
  requesting_device_access: boolean;
  consent_required: boolean;
  confirming_consent: boolean;
  ready_to_begin: boolean;
  joining: boolean;
  waiting_for_avatar: boolean;
  live: boolean;
  ending: boolean;
  ended: boolean;
  failed: boolean;
  config: ManagedConversationConfig | null;
  consent: ConversationConsentConfig | null;
  permissions: ManagedConversationPermissions;
  microphoneEnabled: boolean;
  computerVisionEnabled: boolean;
  error: ProtofaceConversationError | null;
}

export interface ManagedConversationControllerOptions {
  embedId: string;
  apiBaseUrl?: string;
  computerVisionEnabled?: boolean;
  fetch?: typeof fetch;
}

export interface TranscriptEvent {
  id?: string;
  room?: string;
  role?: string;
  text?: string;
  content?: string;
  final?: boolean;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ToolCallEvent {
  name?: string;
  status?: string;
  arguments?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

export interface ManagedConversationEventMap {
  status_changed: { status: ManagedConversationStatus; state: ManagedConversationState };
  device_access_changed: { permissions: ManagedConversationPermissions; state: ManagedConversationState };
  consent_changed: { consent: ConversationConsentConfig | null; accepted: boolean; state: ManagedConversationState };
  ready_to_begin: { state: ManagedConversationState };
  started: { conversationId?: string; room: string; expiresAt: string; state: ManagedConversationState };
  avatar_ready: { state: ManagedConversationState };
  microphone_changed: { enabled: boolean; state: ManagedConversationState };
  computer_vision_changed: { enabled: boolean; state: ManagedConversationState };
  transcript: TranscriptEvent;
  tool_call: ToolCallEvent;
  ended: { reason?: string; state: ManagedConversationState };
  error: { error: ProtofaceConversationError; state: ManagedConversationState };
}

export type ManagedConversationEventName = keyof ManagedConversationEventMap;
export type ManagedConversationListener<EventName extends ManagedConversationEventName> = (
  payload: ManagedConversationEventMap[EventName]
) => void;

export interface SetupResponse {
  setup_token: string;
  expires_at: string;
}

export interface ConversationResponse {
  conversation_id?: string;
  room: string;
  livekit_url: string;
  token: string;
  expires_at: string;
  tool_events?: unknown[];
  computer_vision_enabled: boolean;
}

export type LiveKitRoom = {
  connect(url: string, token: string): Promise<void>;
  disconnect(): void | Promise<void>;
  on(event: unknown, listener: (...args: unknown[]) => void): LiveKitRoom;
  localParticipant: {
    publishTrack(track: MediaStreamTrack, options?: Record<string, unknown>): Promise<unknown>;
    publishData(data: Uint8Array, options?: Record<string, unknown>): Promise<unknown>;
  };
};
