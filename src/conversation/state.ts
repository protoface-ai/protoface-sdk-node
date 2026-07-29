import type {
  ManagedConversationPermissions,
  ManagedConversationState,
  ManagedConversationStatus,
  PermissionState,
  SetupPermissionState
} from "./types";

type StateBase = Omit<ManagedConversationState, "status" | ManagedConversationStatus>;

export const INITIAL_PERMISSIONS: ManagedConversationPermissions = {
  microphone: "unknown",
  computer_vision: "not_requested"
};

const STATUS_KEYS: ManagedConversationStatus[] = [
  "loading",
  "device_access_required",
  "requesting_device_access",
  "consent_required",
  "confirming_consent",
  "ready_to_begin",
  "joining",
  "waiting_for_avatar",
  "live",
  "ending",
  "ended",
  "failed"
];

export function buildState(
  status: ManagedConversationStatus,
  previous: StateBase | ManagedConversationState
): ManagedConversationState {
  const flags = Object.fromEntries(STATUS_KEYS.map((key) => [key, key === status])) as Record<ManagedConversationStatus, boolean>;
  return freezeState({
    ...previous,
    status,
    ...flags
  });
}

export function freezeState(state: ManagedConversationState): ManagedConversationState {
  return Object.freeze({
    ...state,
    permissions: Object.freeze({ ...state.permissions })
  });
}

export function setupPermission(value: PermissionState): SetupPermissionState {
  if (value === "granted" || value === "denied") return value;
  return "not_requested";
}
