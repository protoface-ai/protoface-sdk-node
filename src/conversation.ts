export { ManagedConversationController } from "./conversation/controller";
export { embedAspectRatio } from "./conversation/aspect-ratio";
export { ProtofaceConversationError } from "./conversation/errors";
export type { ProtofaceConversationErrorCode, ProtofaceConversationErrorOptions } from "./conversation/errors";
export type {
  ConversationConsentConfig,
  ManagedConversationConfig,
  ManagedConversationControllerOptions,
  ManagedConversationEventMap,
  ManagedConversationEventName,
  ManagedConversationListener,
  ManagedConversationPermissions,
  ManagedConversationState,
  ManagedConversationStatus,
  PermissionState,
  SetupPermissionState,
  ToolCallEvent,
  TranscriptEvent
} from "./conversation/types";
