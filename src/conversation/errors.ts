export type ProtofaceConversationErrorCode =
  | "invalid_options"
  | "invalid_state"
  | "fetch_unavailable"
  | "network_error"
  | "http_error"
  | "invalid_response"
  | "embed_disabled"
  | "device_access_denied"
  | "media_devices_unavailable"
  | "connection_failed";

export interface ProtofaceConversationErrorOptions {
  code: ProtofaceConversationErrorCode;
  message: string;
  status?: number;
  retryAfter?: number | Date;
  cause?: unknown;
}

export class ProtofaceConversationError extends Error {
  readonly code: ProtofaceConversationErrorCode;
  readonly status?: number;
  readonly retryAfter?: number | Date;
  override readonly cause?: unknown;

  constructor(options: ProtofaceConversationErrorOptions) {
    super(options.message);
    this.name = "ProtofaceConversationError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.cause = options.cause;
  }
}

export function asConversationError(error: unknown): ProtofaceConversationError {
  if (error instanceof ProtofaceConversationError) return error;
  return new ProtofaceConversationError({
    code: "connection_failed",
    message: "Protoface conversation failed.",
    cause: error
  });
}
