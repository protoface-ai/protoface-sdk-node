import type { ManagedConversationConfig } from "./types";

export function embedAspectRatio(config: Pick<ManagedConversationConfig, "source_width" | "source_height"> | null | undefined): string | null {
  if (!config) return null;
  const { source_width: sourceWidth, source_height: sourceHeight } = config;
  if (!isPositiveInteger(sourceWidth) || !isPositiveInteger(sourceHeight)) {
    return null;
  }
  return `${sourceWidth} / ${sourceHeight}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
