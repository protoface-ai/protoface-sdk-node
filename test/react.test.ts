import React, { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (payload: unknown) => void;

const controllers: MockConversationController[] = [];
let drawImage: ReturnType<typeof vi.fn>;
let imageInstances: MockImage[];

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";

  constructor() {
    imageInstances.push(this);
  }
}

class MockConversationController {
  state: Record<string, unknown> = {
    status: "loading",
    loading: true,
    device_access_required: false,
    requesting_device_access: false,
    consent_required: false,
    confirming_consent: false,
    ready_to_begin: false,
    joining: false,
    waiting_for_avatar: false,
    live: false,
    ending: false,
    ended: false,
    failed: false,
    config: null,
    consent: null,
    permissions: { microphone: "unknown", computer_vision: "not_requested" },
    microphoneEnabled: true,
    computerVisionEnabled: false,
    error: null
  };
  listeners = new Map<string, Set<Listener>>();
  load = vi.fn(async () => undefined);
  requestPermissions = vi.fn(async () => undefined);
  acceptConsent = vi.fn(async () => undefined);
  start = vi.fn(async () => undefined);
  end = vi.fn(async () => undefined);
  restart = vi.fn(async () => undefined);
  setMicrophoneEnabled = vi.fn(async (_enabled: boolean) => undefined);
  toggleMicrophone = vi.fn(async () => undefined);
  setMediaElements = vi.fn();

  constructor(readonly options: unknown) {
    controllers.push(this);
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: string, payload: unknown = {}) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  setStatus(status: string) {
    this.state = {
      ...this.state,
      status,
      loading: status === "loading",
      device_access_required: status === "device_access_required",
      consent_required: status === "consent_required",
      ready_to_begin: status === "ready_to_begin",
      live: status === "live"
    };
    this.emit("status_changed", { status, state: this.state });
  }
}

vi.mock("../src/conversation", () => ({
  ManagedConversationController: MockConversationController,
  ProtofaceConversationError: class ProtofaceConversationError extends Error {}
}));

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

async function unmount(root: Root) {
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  controllers.length = 0;
  imageInstances = [];
  document.body.innerHTML = "";
  drawImage = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.stubGlobal("Image", MockImage);
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 512 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 512 });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
});

describe("React conversation bindings", () => {
  it("creates one controller per stable embed/base URL and ends on unmount", async () => {
    const { useProtofaceConversation } = await import("../src/react");
    function Host() {
      const conversation = useProtofaceConversation({ embedId: "emb_1", apiBaseUrl: "https://api.example", computerVisionEnabled: false });
      return React.createElement("span", null, conversation.status);
    }

    const { root } = await render(React.createElement(Host));
    expect(controllers).toHaveLength(1);
    expect(controllers[0].options).toMatchObject({ computerVisionEnabled: false });
    expect(controllers[0].load).toHaveBeenCalledTimes(1);

    await unmount(root);
    expect(controllers[0].end).toHaveBeenCalledTimes(1);
  });

  it("does not tear down a valid connection during React Strict Mode effect replay", async () => {
    const { useProtofaceConversation } = await import("../src/react");
    function Host() {
      useProtofaceConversation({ embedId: "emb_1", apiBaseUrl: "https://api.example" });
      return null;
    }

    const { root } = await render(React.createElement(StrictMode, null, React.createElement(Host)));

    expect(controllers).toHaveLength(2);
    expect(controllers[1].load).toHaveBeenCalledTimes(1);
    expect(controllers[1].end).not.toHaveBeenCalled();

    await unmount(root);
    expect(controllers[1].end).toHaveBeenCalledTimes(1);
  });

  it("rerenders status from controller events", async () => {
    const { useProtofaceConversation } = await import("../src/react");
    function Host() {
      const conversation = useProtofaceConversation({ embedId: "emb_1" });
      return React.createElement("span", { "data-testid": "status" }, conversation.status);
    }
    const { container } = await render(React.createElement(Host));

    expect(container.textContent).toBe("loading");
    await act(async () => controllers[0].setStatus("ready_to_begin"));

    expect(container.textContent).toBe("ready_to_begin");
  });

  it("renders only media elements and wires avatar attachment", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    const { container, root } = await render(
      React.createElement(ProtofaceAvatar, {
        conversation: conversation as never,
        className: "stage",
        style: { width: 320 }
      })
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("aria-label")).toBe("Protoface avatar video");
    expect(container.querySelector("audio")?.getAttribute("aria-label")).toBe("Protoface avatar audio");
    expect(conversation.setMediaElements).toHaveBeenLastCalledWith({
      videoElement: container.querySelector("video"),
      audioElement: container.querySelector("audio")
    });

    await unmount(root);
    expect(conversation.setMediaElements).toHaveBeenLastCalledWith({ videoElement: null, audioElement: null });
  });

  it("exports embedAspectRatio from the React entrypoint", async () => {
    const { embedAspectRatio } = await import("../src/react");

    expect(embedAspectRatio({ source_width: 1280, source_height: 720 })).toBe("1280 / 720");
  });

  it("uses source dimensions to crop landscape padding from the standardized square avatar video", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        source_width: 1280,
        source_height: 720,
        consent: { version: "v1", enabled: false }
      }
    };

    const { container, root } = await render(
      React.createElement(ProtofaceAvatar, {
        conversation: conversation as never
      })
    );

    const avatar = container.firstElementChild as HTMLElement;
    const video = container.querySelector("video");
    const canvas = container.querySelector("canvas");
    expect(avatar.style.aspectRatio).toBe("");
    expect(avatar.style.overflow).toBe("hidden");
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
    expect(canvas?.style.position).toBe("absolute");
    expect(canvas?.style.inset).toBe("0px");
    expect(canvas?.style.width).toBe("100%");
    expect(canvas?.style.height).toBe("100%");
    expect(canvas?.style.objectFit).toBe("cover");
    expect(video?.style.visibility).toBe("hidden");
    expect(video?.style.objectFit).toBe("cover");
    expect(drawImage).toHaveBeenCalledWith(video, 0, 112, 512, 288, 0, 0, 1280, 720);

    await unmount(root);
  });

  it("sets object-fit cover on the direct video fallback", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});

    const { container, root } = await render(
      React.createElement(ProtofaceAvatar, {
        conversation: conversation as never
      })
    );

    const video = container.querySelector("video");
    expect(video?.style.width).toBe("100%");
    expect(video?.style.height).toBe("100%");
    expect(video?.style.objectFit).toBe("cover");

    await unmount(root);
  });

  it("uses source dimensions to crop portrait padding from the standardized square avatar video", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        source_width: 720,
        source_height: 1280,
        consent: { version: "v1", enabled: false }
      }
    };

    const { container, root } = await render(
      React.createElement(ProtofaceAvatar, {
        conversation: conversation as never
      })
    );

    const video = container.querySelector("video");
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(720);
    expect(canvas?.height).toBe(1280);
    expect(drawImage).toHaveBeenCalledWith(video, 112, 0, 288, 512, 0, 0, 720, 1280);

    await unmount(root);
  });

  it("uses portrait preview dimensions to crop when source dimensions are unavailable", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        portrait_url: "https://example.com/cropped-preview.jpg",
        consent: { version: "v1", enabled: false }
      }
    };

    const { container, root } = await render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));

    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("aria-label")).toBe("Protoface avatar video");
    expect(imageInstances).toHaveLength(1);
    expect(imageInstances[0].src).toBe("https://example.com/cropped-preview.jpg");

    await act(async () => {
      imageInstances[0].naturalWidth = 720;
      imageInstances[0].naturalHeight = 1280;
      imageInstances[0].onload?.();
    });

    const video = container.querySelector("video");
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(720);
    expect(canvas?.height).toBe(1280);
    expect(video?.getAttribute("aria-label")).toBe("Protoface source avatar video");
    expect(drawImage).toHaveBeenCalledWith(video, 112, 0, 288, 512, 0, 0, 720, 1280);

    await unmount(root);
  });

  it("keeps source dimensions ahead of portrait preview dimensions", async () => {
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        portrait_url: "https://example.com/square-preview.jpg",
        consent: { version: "v1", enabled: false }
      }
    };

    const { container, root } = await render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));

    await act(async () => {
      imageInstances[0].naturalWidth = 512;
      imageInstances[0].naturalHeight = 512;
      imageInstances[0].onload?.();
    });

    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        portrait_url: "https://example.com/square-preview.jpg",
        source_width: 1280,
        source_height: 720,
        consent: { version: "v1", enabled: false }
      }
    };
    await act(async () => {
      root.render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));
    });

    const video = container.querySelector("video");
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 112, 512, 288, 0, 0, 1280, 720);

    await unmount(root);
  });

  it("keeps the avatar crop frame loop running across unrelated rerenders", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const requestAnimationFrameMock = requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    const cancelAnimationFrameMock = cancelAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        source_width: 1280,
        source_height: 720,
        consent: { version: "v1", enabled: false }
      }
    };

    const { root } = await render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));
    });

    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    await unmount(root);
    vi.unstubAllGlobals();
  });

  it("keeps the portrait crop frame loop running across unrelated rerenders", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const requestAnimationFrameMock = requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    const cancelAnimationFrameMock = cancelAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    const { ProtofaceAvatar } = await import("../src/react");
    const conversation = new MockConversationController({});
    conversation.state = {
      ...conversation.state,
      config: {
        enabled: true,
        computer_vision_enabled: false,
        portrait_url: "https://example.com/cropped-preview.jpg",
        consent: { version: "v1", enabled: false }
      }
    };

    const { root } = await render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();

    await act(async () => {
      imageInstances[0].naturalWidth = 1280;
      imageInstances[0].naturalHeight = 720;
      imageInstances[0].onload?.();
    });

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(React.createElement(ProtofaceAvatar, { conversation: conversation as never }));
    });

    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

    await unmount(root);
    vi.unstubAllGlobals();
  });

  it("leaves permission, consent, start, mute, and end calls to host UI", async () => {
    const { useProtofaceConversation } = await import("../src/react");
    function Host() {
      const conversation = useProtofaceConversation({ embedId: "emb_1" });
      useEffect(() => {
        void conversation.requestPermissions();
        void conversation.acceptConsent();
        void conversation.start();
        void conversation.toggleMicrophone();
        void conversation.end();
      }, [conversation]);
      return null;
    }

    const { root } = await render(React.createElement(Host));

    expect(controllers[0].requestPermissions).toHaveBeenCalledTimes(1);
    expect(controllers[0].acceptConsent).toHaveBeenCalledTimes(1);
    expect(controllers[0].start).toHaveBeenCalledTimes(1);
    expect(controllers[0].toggleMicrophone).toHaveBeenCalledTimes(1);
    expect(controllers[0].end).toHaveBeenCalledTimes(1);

    await unmount(root);
  });
});
