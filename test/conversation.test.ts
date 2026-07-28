import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedConversationController, ProtofaceConversationError } from "../src/conversation";

type FetchCall = { url: string; init?: RequestInit };

const roomInstances: MockRoom[] = [];
let trackDuringConnect: unknown = null;

class MockTrack {
  enabled = true;
  stopped = false;
  constructor(readonly kind: string) {}
  stop() {
    this.stopped = true;
  }
}

class MockStream {
  constructor(private readonly tracks: MockTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

class MockRoom {
  handlers = new Map<string, (...args: unknown[]) => void>();
  connected = false;
  disconnected = false;
  publishedTracks: unknown[] = [];
  publishedData: Array<{ data: Uint8Array; options?: Record<string, unknown> }> = [];
  localParticipant = {
    publishTrack: vi.fn(async (track: unknown, options?: Record<string, unknown>) => {
      this.publishedTracks.push({ track, options });
    }),
    publishData: vi.fn(async (data: Uint8Array, options?: Record<string, unknown>) => {
      this.publishedData.push({ data, options });
    })
  };

  constructor() {
    roomInstances.push(this);
  }

  on(event: string, listener: (...args: unknown[]) => void) {
    this.handlers.set(event, listener);
    return this;
  }

  async connect(url: string, token: string) {
    if (url === "wss://fail.example") throw new Error("connect failed");
    this.connected = token === "viewer-token";
    if (trackDuringConnect) {
      this.emit("trackSubscribed", trackDuringConnect);
    }
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }
}

vi.mock("livekit-client", () => ({
  Room: MockRoom,
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    DataReceived: "dataReceived",
    TranscriptionReceived: "transcriptionReceived",
    Disconnected: "disconnected"
  }
}));

const configResponse = {
  enabled: true,
  avatar_name: "Ada",
  cta_title: "Talk with our AI avatar",
  cta_description: "Ask questions and get a live voice response.",
  cta_button_label: "Start talking",
  portrait_url: "https://example.com/ada.jpg",
  computer_vision_enabled: true,
  consent: {
    version: "v1",
    enabled: true,
    text: "I agree to this site's Terms of Service. This conversation may be recorded.",
    computer_vision_text: "Starting will ask to use your front camera for this conversation; images are not stored."
  }
};

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
}

function makeFetch(overrides: Partial<Record<string, Response | ((call: FetchCall) => Response | Promise<Response>)>> = {}) {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = String(url);
    calls.push({ url: urlString, init });
    for (const [suffix, override] of Object.entries(overrides)) {
      if (urlString.endsWith(suffix)) {
        return typeof override === "function" ? override({ url: urlString, init }) : override;
      }
    }
    if (urlString.endsWith("/config")) return response(configResponse);
    if (urlString.endsWith("/setup")) return response({ setup_token: "aecs_secret", expires_at: "2026-07-28T00:00:00Z" });
    if (urlString.endsWith("/conversations")) {
      return response({
        conversation_id: "conv_1",
        room: "room-1",
        livekit_url: "wss://lk.example",
        token: "viewer-token",
        expires_at: "2026-07-28T00:01:00Z",
        tool_events: [],
        computer_vision_enabled: true
      });
    }
    if (urlString.endsWith("/stop")) return response({});
    return response({ error: "missing" }, { status: 404 });
  });
  return { fetchImpl, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  roomInstances.length = 0;
  trackDuringConnect = null;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValueOnce(new MockStream([new MockTrack("audio")]))
        .mockResolvedValueOnce(new MockStream([new MockTrack("video")]))
    }
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
    callback({
      size: 4,
      type: "image/jpeg",
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    } as Blob);
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = createElement(tagName, options);
    if (tagName.toLowerCase() === "video") {
      Object.defineProperty(element, "videoWidth", { configurable: true, value: 640 });
      Object.defineProperty(element, "videoHeight", { configurable: true, value: 360 });
      Object.defineProperty(element, "readyState", { configurable: true, value: 2 });
    }
    return element;
  }) as typeof document.createElement);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(async () => undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 360 });
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", { configurable: true, value: 2 });
});

describe("ManagedConversationController", () => {
  it("orders setup state, connects LiveKit, publishes mic, and emits avatar_ready", async () => {
    const { fetchImpl } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", apiBaseUrl: "https://sdk.example/", fetch: fetchImpl as typeof fetch });
    const statuses: string[] = [];
    controller.on("status_changed", ({ status }) => statuses.push(status));
    const avatarReady = vi.fn();
    controller.on("avatar_ready", avatarReady);
    controller.setMediaElements({ videoElement: document.createElement("video") });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();
    roomInstances[0].emit("trackSubscribed", { kind: "video", attach: vi.fn(), detach: vi.fn() });

    expect(statuses).toEqual([
      "loading",
      "device_access_required",
      "requesting_device_access",
      "consent_required",
      "confirming_consent",
      "ready_to_begin",
      "joining",
      "waiting_for_avatar",
      "live"
    ]);
    expect(roomInstances[0].publishedTracks).toHaveLength(1);
    expect(avatarReady).toHaveBeenCalledTimes(1);
    expect(controller.state.live).toBe(true);
  });

  it("enters live when the avatar track subscribes before waiting_for_avatar", async () => {
    const { fetchImpl } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });
    const avatarReady = vi.fn();
    controller.on("avatar_ready", avatarReady);
    trackDuringConnect = { kind: "video", attach: vi.fn(), detach: vi.fn() };
    controller.setMediaElements({ videoElement: document.createElement("video") });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    expect(controller.state.live).toBe(true);
    expect(avatarReady).toHaveBeenCalledTimes(1);
  });

  it("waits for a readable avatar video frame before entering live", async () => {
    const { fetchImpl } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });
    const avatarReady = vi.fn();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 0 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 0 });
    controller.on("avatar_ready", avatarReady);
    controller.setMediaElements({ videoElement: video });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();
    roomInstances[0].emit("trackSubscribed", { kind: "video", attach: vi.fn(), detach: vi.fn() });

    expect(controller.state.waiting_for_avatar).toBe(true);
    expect(avatarReady).not.toHaveBeenCalled();

    Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 360 });
    video.dispatchEvent(new Event("loadeddata"));

    expect(controller.state.live).toBe(true);
    expect(avatarReady).toHaveBeenCalledTimes(1);
  });

  it("uses configurable base URL and submits the current consent version", async () => {
    const { fetchImpl, calls } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb/a b", apiBaseUrl: "https://d30g6h46g7xfpj.cloudfront.net/", fetch: fetchImpl as typeof fetch });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();

    const setup = calls.find((call) => call.url.endsWith("/setup"));
    expect(calls[0].url).toBe("https://d30g6h46g7xfpj.cloudfront.net/api/v1/embed/emb%2Fa%20b/config");
    expect(JSON.parse(String(setup?.init?.body))).toMatchObject({
      permissions: { microphone: "granted", computer_vision: "granted" },
      consent: { version: "v1", accepted: true }
    });
  });

  it("captures front camera permission but only publishes the microphone track", async () => {
    const { fetchImpl, calls } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/conversations"))?.init?.body))).toMatchObject({
      setup_token: "aecs_secret",
      permissions: { microphone: "granted", computer_vision: "granted" }
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, { video: { facingMode: "user" } });
    expect(roomInstances[0].publishedTracks).toHaveLength(1);
    expect(roomInstances[0].publishedTracks[0]).toMatchObject({ options: { source: "microphone" } });
  });

  it("does not request or pass camera video when disabled by the host", async () => {
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(new MockStream([new MockTrack("audio")]))
      .mockResolvedValueOnce(new MockStream([new MockTrack("video")]));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const { fetchImpl, calls } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", computerVisionEnabled: false, fetch: fetchImpl as typeof fetch });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/setup"))?.init?.body))).toMatchObject({
      permissions: { microphone: "granted", computer_vision: "not_requested" },
      consent: { version: "v1", accepted: true }
    });
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/conversations"))?.init?.body))).toMatchObject({
      permissions: { microphone: "granted", computer_vision: "not_requested" }
    });
    expect(controller.state.computerVisionEnabled).toBe(false);
  });

  it("creates setup and becomes ready after permissions when consent is disabled", async () => {
    const { fetchImpl, calls } = makeFetch({
      "/config": response({
        ...configResponse,
        consent: { version: "v1", enabled: false }
      })
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });
    const ready = vi.fn();
    controller.on("ready_to_begin", ready);

    await controller.load();
    await controller.requestPermissions();

    expect(controller.state.ready_to_begin).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/setup"))?.init?.body))).toMatchObject({
      permissions: { microphone: "granted", computer_vision: "granted" }
    });
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/setup"))?.init?.body))).not.toHaveProperty("consent");
  });

  it("moves to failed with an error when load requests fail", async () => {
    const controller = new ManagedConversationController({
      embedId: "emb_1",
      fetch: makeFetch({ "/config": response({ error: "unavailable" }, { status: 503 }) }).fetchImpl as typeof fetch
    });

    await expect(controller.load()).rejects.toMatchObject({ code: "http_error", status: 503 });

    expect(controller.state.failed).toBe(true);
    expect(controller.state.error).toMatchObject({ code: "http_error", status: 503 });
  });

  it("moves to failed with an error when setup requests fail", async () => {
    const controller = new ManagedConversationController({
      embedId: "emb_1",
      fetch: makeFetch({ "/setup": response({ error: "unavailable" }, { status: 503 }) }).fetchImpl as typeof fetch
    });

    await controller.load();
    await controller.requestPermissions();
    await expect(controller.acceptConsent()).rejects.toMatchObject({ code: "http_error", status: 503 });

    expect(controller.state.failed).toBe(true);
    expect(controller.state.error).toMatchObject({ code: "http_error", status: 503 });
  });

  it("stops microphone tracks acquired after the request becomes stale", async () => {
    let resolveMic: ((stream: MockStream) => void) | undefined;
    const micTrack = new MockTrack("audio");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => new Promise<MockStream>((resolve) => {
          resolveMic = resolve;
        }))
      }
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });

    await controller.load();
    const permissions = controller.requestPermissions();
    await controller.end();
    resolveMic?.(new MockStream([micTrack]));
    await permissions;

    expect(micTrack.stopped).toBe(true);
    expect(controller.state.ended).toBe(true);
  });

  it("stops camera tracks acquired after the request becomes stale", async () => {
    let resolveCamera: ((stream: MockStream) => void) | undefined;
    const micTrack = new MockTrack("audio");
    const cameraTrack = new MockTrack("video");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValueOnce(new MockStream([micTrack]))
          .mockImplementationOnce(() => new Promise<MockStream>((resolve) => {
            resolveCamera = resolve;
          }))
      }
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });

    await controller.load();
    const permissions = controller.requestPermissions();
    await Promise.resolve();
    await controller.end();
    resolveCamera?.(new MockStream([cameraTrack]));
    await permissions;

    expect(cameraTrack.stopped).toBe(true);
    expect(controller.state.ended).toBe(true);
  });

  it("preserves loaded server config while a refresh load is in flight", async () => {
    let configCalls = 0;
    let resolveSecondConfig: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/config")) {
        configCalls += 1;
        if (configCalls === 1) {
          return response({
            ...configResponse,
            cta_title: "Talk with our AI avatar",
            cta_description: "Ask questions and get a live voice response."
          });
        }
        return new Promise<Response>((resolve) => {
          resolveSecondConfig = resolve;
        });
      }
      return response({});
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });

    await controller.load();
    expect(controller.state.config?.cta_title).toBe("Talk with our AI avatar");

    const refresh = controller.load();
    expect(controller.state.loading).toBe(true);
    expect(controller.state.config?.cta_title).toBe("Talk with our AI avatar");
    expect(controller.state.consent?.text).toBe("I agree to this site's Terms of Service. This conversation may be recorded.");

    resolveSecondConfig?.(response({ ...configResponse, cta_title: "Updated server title" }));
    await refresh;

    expect(controller.state.config?.cta_title).toBe("Updated server title");
  });

  it("ignores a load response after the controller has ended", async () => {
    let resolveConfig: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/config")) {
        return new Promise<Response>((resolve) => {
          resolveConfig = resolve;
        });
      }
      return response({});
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });

    const load = controller.load();
    await controller.end();
    resolveConfig?.(response(configResponse));
    await load;

    expect(controller.state.ended).toBe(true);
    expect(controller.state.config).toBeNull();
  });

  it("binds browser fetch by default so Window.fetch is callable", async () => {
    const unbound = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(response(configResponse));
    });
    const previous = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: unbound });
    try {
      const controller = new ManagedConversationController({ embedId: "emb_1" });
      await controller.load();
      expect(unbound).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: previous });
    }
  });

  it("blocks setup when microphone access is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValueOnce(new DOMException("denied", "NotAllowedError")) }
    });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });
    await controller.load();

    await expect(controller.requestPermissions()).rejects.toMatchObject({ code: "device_access_denied" });
    expect(controller.state.failed).toBe(true);
    expect(controller.state.permissions.microphone).toBe("denied");
  });

  it("degrades to audio only when camera access is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValueOnce(new MockStream([new MockTrack("audio")]))
          .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      }
    });
    const { fetchImpl, calls } = makeFetch({ "/conversations": response({
      conversation_id: "conv_1",
      room: "room-1",
      livekit_url: "wss://lk.example",
      token: "viewer-token",
      expires_at: "2026-07-28T00:01:00Z",
      computer_vision_enabled: false
    }) });
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });

    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/setup"))?.init?.body))).toMatchObject({
      permissions: { computer_vision: "denied" }
    });
    expect(controller.state.computerVisionEnabled).toBe(false);
  });

  it("clears setup token before start request so failures cannot replay it", async () => {
    const controller = new ManagedConversationController({
      embedId: "emb_1",
      fetch: makeFetch({ "/conversations": response({ code: "used" }, { status: 409, headers: { "retry-after": "3" } }) }).fetchImpl as typeof fetch
    });
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();

    await expect(controller.start()).rejects.toMatchObject({ code: "http_error", status: 409, retryAfter: 3 });
    await expect(controller.start()).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("converts malformed responses and connection failures to typed errors with cleanup", async () => {
    const invalid = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch({ "/config": response({ enabled: true }) }).fetchImpl as typeof fetch });
    await expect(invalid.load()).rejects.toBeInstanceOf(ProtofaceConversationError);
    await expect(invalid.load()).rejects.toMatchObject({ code: "invalid_response" });

    const failing = new ManagedConversationController({
      embedId: "emb_1",
      fetch: makeFetch({ "/conversations": response({
        room: "room-1",
        livekit_url: "wss://fail.example",
        token: "viewer-token",
        expires_at: "2026-07-28T00:01:00Z",
        computer_vision_enabled: true
      }) }).fetchImpl as typeof fetch
    });
    await failing.load();
    await failing.requestPermissions();
    await failing.acceptConsent();
    await expect(failing.start()).rejects.toMatchObject({ code: "connection_failed" });
    expect(failing.state.failed).toBe(true);
  });

  it("publishes bounded computer-vision JPEG snapshots on the expected reliable topic", async () => {
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    await (controller as unknown as { publishVisionFrame(room: MockRoom): Promise<void> }).publishVisionFrame(roomInstances[0]);

    expect(roomInstances[0].publishedData[0]?.options).toEqual({ reliable: true, topic: "protoface.embed.vision-frame" });
    const envelope = JSON.parse(new TextDecoder().decode(roomInstances[0].publishedData[0].data));
    expect(envelope).toMatchObject({
      type: "vision_frame",
      mime_type: "image/jpeg",
      width: 512,
      height: 288,
      byte_length: 4,
      data: "AQIDBA=="
    });
    expect(Date.parse(envelope.captured_at)).not.toBeNaN();
  });

  it("does not publish oversized computer-vision snapshots", async () => {
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
      callback({
        size: 96 * 1024 + 1,
        type: "image/jpeg",
        arrayBuffer: async () => new Uint8Array(96 * 1024 + 1).buffer
      } as Blob);
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    await (controller as unknown as { publishVisionFrame(room: MockRoom): Promise<void> }).publishVisionFrame(roomInstances[0]);

    expect(roomInstances[0].publishedData).toHaveLength(0);
  });

  it("emits sanitized tool events and ignores transcript-looking LiveKit data packets", async () => {
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });
    const transcript = vi.fn();
    const tool = vi.fn();
    controller.on("transcript", transcript);
    controller.on("tool_call", tool);
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    roomInstances[0].emit("dataReceived", new TextEncoder().encode(JSON.stringify({ type: "transcript", text: "hi", token: "secret" })), undefined, undefined, "transcript");
    roomInstances[0].emit("dataReceived", new TextEncoder().encode(JSON.stringify({ role: "assistant", message: "hello" })), undefined, undefined, "messages");
    roomInstances[0].emit("dataReceived", new TextEncoder().encode(JSON.stringify({ type: "tool_call", name: "lookup", setup_token: "secret" })), undefined, undefined, "tool");

    expect(transcript).not.toHaveBeenCalled();
    expect(tool).toHaveBeenCalledWith({ type: "tool_call", name: "lookup" });
  });

  it("emits streamed native LiveKit transcription segments", async () => {
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: makeFetch().fetchImpl as typeof fetch });
    const transcript = vi.fn();
    controller.on("transcript", transcript);
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    roomInstances[0].emit(
      "transcriptionReceived",
      [
        { id: "seg_1", text: "partial", final: false },
        { id: "seg_2", text: "final text", final: true }
      ],
      { identity: "agent-1" }
    );

    expect(transcript).toHaveBeenCalledWith({
      id: "seg_1",
      room: "room-1",
      role: "agent",
      content: "partial",
      final: false
    });
    expect(transcript).toHaveBeenCalledWith({
      id: "seg_2",
      room: "room-1",
      role: "agent",
      content: "final text",
      final: true
    });
    expect(transcript).toHaveBeenCalledTimes(2);
  });

  it("dedupes terminal events and performs no-preflight stop cleanup", async () => {
    const { fetchImpl, calls } = makeFetch();
    const controller = new ManagedConversationController({ embedId: "emb_1", fetch: fetchImpl as typeof fetch });
    const ended = vi.fn();
    controller.on("ended", ended);
    await controller.load();
    await controller.requestPermissions();
    await controller.acceptConsent();
    await controller.start();

    await controller.end();
    await controller.end();

    const stop = calls.find((call) => call.url.endsWith("/stop"));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(roomInstances[0].disconnected).toBe(true);
    expect(stop?.init).toMatchObject({ method: "POST", mode: "no-cors", keepalive: true });
    expect(stop?.init?.headers).toBeUndefined();
  });
});
