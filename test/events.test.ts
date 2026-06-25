import { describe, expect, it } from "vitest";

import { TypedEventEmitter } from "../src/events";

interface Events {
  start: { sessionId: string };
  stop: undefined;
}

describe("TypedEventEmitter", () => {
  it("emits events to listeners and supports unsubscribe", () => {
    const emitter = new TypedEventEmitter<Events>();
    const seen: string[] = [];

    const unsubscribe = emitter.on("start", (payload) => {
      seen.push(payload.sessionId);
    });

    emitter.emit("start", { sessionId: "sess_123" });
    unsubscribe();
    emitter.emit("start", { sessionId: "sess_456" });

    expect(seen).toEqual(["sess_123"]);
  });
});
