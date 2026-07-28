import type { ConversationConsentConfig, ConversationResponse, ManagedConversationConfig, SetupResponse } from "./types";

export function validateConfig(value: unknown): ManagedConversationConfig {
  const record = requireRecord(value);
  requireBoolean(record.enabled, "enabled");
  requireBoolean(record.computer_vision_enabled, "computer_vision_enabled");
  const consentRecord = requireRecord(record.consent);
  requireString(consentRecord.version, "consent.version");
  requireBoolean(consentRecord.enabled, "consent.enabled");
  return Object.freeze({
    ...record,
    consent: Object.freeze({ ...consentRecord }) as ConversationConsentConfig
  }) as ManagedConversationConfig;
}

export function validateSetupResponse(value: unknown): SetupResponse {
  const record = requireRecord(value);
  requireString(record.setup_token, "setup_token");
  requireString(record.expires_at, "expires_at");
  return record as unknown as SetupResponse;
}

export function validateConversationResponse(value: unknown): ConversationResponse {
  const record = requireRecord(value);
  requireString(record.room, "room");
  requireString(record.livekit_url, "livekit_url");
  requireString(record.token, "token");
  requireString(record.expires_at, "expires_at");
  requireBoolean(record.computer_vision_enabled, "computer_vision_enabled");
  return record as unknown as ConversationResponse;
}

export function parseRetryAfter(value: string | null): number | Date | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object response.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${field} to be a non-empty string.`);
  }
}

function requireBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${field} to be a boolean.`);
  }
}
