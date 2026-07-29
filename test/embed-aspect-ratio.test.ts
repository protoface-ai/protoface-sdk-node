import { describe, expect, it } from "vitest";

import { embedAspectRatio, type ManagedConversationConfig } from "../src/conversation";

const baseConfig: ManagedConversationConfig = {
  enabled: true,
  avatar_name: "Ada",
  portrait_url: "https://example.com/cropped-square-preview.jpg",
  computer_vision_enabled: false,
  consent: {
    version: "v1",
    enabled: false
  }
};

describe("embedAspectRatio", () => {
  it("returns source width over source height for valid uploaded-avatar dimensions", () => {
    expect(embedAspectRatio({ ...baseConfig, source_width: 1280, source_height: 720 })).toBe("1280 / 720");
  });

  it("returns null when source dimensions are absent or null", () => {
    expect(embedAspectRatio(null)).toBeNull();
    expect(embedAspectRatio(undefined)).toBeNull();
    expect(embedAspectRatio(baseConfig)).toBeNull();
    expect(embedAspectRatio({ ...baseConfig, source_width: null, source_height: 720 })).toBeNull();
    expect(embedAspectRatio({ ...baseConfig, source_width: 1280, source_height: null })).toBeNull();
  });

  it("returns null for non-positive or non-integer dimensions", () => {
    expect(embedAspectRatio({ ...baseConfig, source_width: 0, source_height: 720 })).toBeNull();
    expect(embedAspectRatio({ ...baseConfig, source_width: -1280, source_height: 720 })).toBeNull();
    expect(embedAspectRatio({ ...baseConfig, source_width: 1280.5, source_height: 720 })).toBeNull();
    expect(embedAspectRatio({ ...baseConfig, source_width: 1280, source_height: Number.NaN })).toBeNull();
  });

  it("uses source dimensions instead of inferring from cropped portrait previews", () => {
    const config = {
      ...baseConfig,
      portrait_url: "https://example.com/portrait-preview-cropped-to-square.jpg",
      source_width: 1080,
      source_height: 1920
    };

    expect(embedAspectRatio(config)).toBe("1080 / 1920");
  });
});
