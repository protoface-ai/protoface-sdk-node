import { describe, expect, it } from "vitest";

import { WebAudioPcmSource } from "../src/audio";

describe("WebAudioPcmSource", () => {
  it("defaults to smaller PCM chunks for lower capture latency", () => {
    const source = new WebAudioPcmSource();

    expect(Reflect.get(source, "chunkSize")).toBe(1024);
  });
});
