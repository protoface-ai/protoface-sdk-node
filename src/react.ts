import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ProtofaceClient } from "./client";
import type { StopListening } from "./audio";
import type { ProtofaceClientOptions, ProtofaceClientStatus } from "./types";
import { embedAspectRatio } from "./conversation/aspect-ratio";
import {
  ManagedConversationController,
  ProtofaceConversationError,
  type ConversationConsentConfig,
  type ManagedConversationConfig,
  type ManagedConversationControllerOptions,
  type ManagedConversationEventName,
  type ManagedConversationListener,
  type ManagedConversationPermissions,
  type ManagedConversationStatus
} from "./conversation";

export { embedAspectRatio };

export interface UseProtofaceClientOptions
  extends Omit<ProtofaceClientOptions, "videoElement" | "audioElement"> {
  videoRef?: React.RefObject<HTMLVideoElement>;
  audioRef?: React.RefObject<HTMLAudioElement>;
}

export interface UseProtofaceClientResult {
  client: ProtofaceClient;
  status: ProtofaceClientStatus;
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendAudioData: (audioData: Uint8Array) => Promise<void>;
  listenToMediaStreamTrack: (track: MediaStreamTrack) => Promise<StopListening>;
  clearBuffer: () => Promise<void>;
}

export function useProtofaceClient(options: UseProtofaceClientOptions): UseProtofaceClientResult {
  const [status, setStatus] = useState<ProtofaceClientStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const client = useMemo(
    () =>
      new ProtofaceClient({
        ...optionsRef.current,
        videoElement: optionsRef.current.videoRef?.current,
        audioElement: optionsRef.current.audioRef?.current
      }),
    [
      options.apiKey,
      options.apiUrl,
      options.avatarId,
      options.livekitUrl,
      options.roomName,
      options.participantToken,
      options.workerToken,
      options.workerIdentity
    ]
  );

  useEffect(() => {
    const offStart = client.on("start", () => setStatus(client.status));
    const offStop = client.on("stop", () => setStatus(client.status));
    const offError = client.on("error", ({ error: eventError }) => {
      setError(eventError);
      setStatus(client.status);
    });
    return () => {
      offStart();
      offStop();
      offError();
      void client.stop();
    };
  }, [client]);

  const start = useCallback(async () => {
    setStatus("starting");
    setError(null);
    client.setMediaElements({
      videoElement: optionsRef.current.videoRef?.current,
      audioElement: optionsRef.current.audioRef?.current
    });
    await client.start();
    setStatus(client.status);
  }, [client]);

  const stop = useCallback(async () => {
    setStatus("stopping");
    await client.stop();
    setStatus(client.status);
  }, [client]);

  return {
    client,
    status,
    error,
    start,
    stop,
    sendAudioData: client.sendAudioData.bind(client),
    listenToMediaStreamTrack: client.listenToMediaStreamTrack.bind(client),
    clearBuffer: client.clearBuffer.bind(client)
  };
}

export interface UseProtofaceConversationOptions extends ManagedConversationControllerOptions {}

export interface UseProtofaceConversationResult {
  conversation: ManagedConversationController;
  status: ManagedConversationStatus;
  config: ManagedConversationConfig | null;
  consent: ConversationConsentConfig | null;
  permissions: ManagedConversationPermissions;
  error: ProtofaceConversationError | null;
  load: () => Promise<void>;
  requestPermissions: () => Promise<void>;
  acceptConsent: () => Promise<void>;
  start: () => Promise<void>;
  end: () => Promise<void>;
  restart: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  on: <EventName extends ManagedConversationEventName>(
    event: EventName,
    listener: ManagedConversationListener<EventName>
  ) => () => void;
}

export interface ProtofaceAvatarProps {
  conversation: ManagedConversationController;
  className?: string;
  style?: React.CSSProperties;
}

const strictModeCleanupTimers = new WeakMap<ManagedConversationController, ReturnType<typeof setTimeout>>();
const loadedControllers = new WeakSet<ManagedConversationController>();

export function useProtofaceConversation(options: UseProtofaceConversationOptions): UseProtofaceConversationResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const conversation = useMemo(
    () =>
      new ManagedConversationController({
        embedId: optionsRef.current.embedId,
        apiBaseUrl: optionsRef.current.apiBaseUrl,
        computerVisionEnabled: optionsRef.current.computerVisionEnabled,
        fetch: optionsRef.current.fetch
      }),
    [options.embedId, options.apiBaseUrl, options.computerVisionEnabled]
  );

  const [snapshot, setSnapshot] = useState(() => conversation.state);

  useEffect(() => {
    const pendingCleanup = strictModeCleanupTimers.get(conversation);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      strictModeCleanupTimers.delete(conversation);
    }

    const sync = () => setSnapshot(conversation.state);
    const unsubscribers = [
      conversation.on("status_changed", sync),
      conversation.on("device_access_changed", sync),
      conversation.on("consent_changed", sync),
      conversation.on("microphone_changed", sync),
      conversation.on("computer_vision_changed", sync),
      conversation.on("error", sync),
      conversation.on("ended", sync)
    ];

    sync();
    if (!loadedControllers.has(conversation)) {
      loadedControllers.add(conversation);
      void conversation.load().catch(() => undefined);
    }

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      const timer = setTimeout(() => {
        strictModeCleanupTimers.delete(conversation);
        void conversation.end();
      }, 0);
      strictModeCleanupTimers.set(conversation, timer);
    };
  }, [conversation]);

  const load = useCallback(() => conversation.load(), [conversation]);
  const requestPermissions = useCallback(() => conversation.requestPermissions(), [conversation]);
  const acceptConsent = useCallback(() => conversation.acceptConsent(), [conversation]);
  const start = useCallback(() => conversation.start(), [conversation]);
  const end = useCallback(() => conversation.end(), [conversation]);
  const restart = useCallback(() => conversation.restart(), [conversation]);
  const setMicrophoneEnabled = useCallback((enabled: boolean) => conversation.setMicrophoneEnabled(enabled), [conversation]);
  const toggleMicrophone = useCallback(() => conversation.toggleMicrophone(), [conversation]);
  const on = useCallback(
    <EventName extends ManagedConversationEventName>(
      event: EventName,
      listener: ManagedConversationListener<EventName>
    ) => conversation.on(event, listener),
    [conversation]
  );

  return {
    conversation,
    status: snapshot.status,
    config: snapshot.config,
    consent: snapshot.consent,
    permissions: snapshot.permissions,
    error: snapshot.error,
    load,
    requestPermissions,
    acceptConsent,
    start,
    end,
    restart,
    setMicrophoneEnabled,
    toggleMicrophone,
    on
  };
}

export function ProtofaceAvatar({ conversation, className, style }: ProtofaceAvatarProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspectRatio = embedAspectRatio(conversation.state.config);
  const crop = avatarCrop(conversation.state.config);

  useLayoutEffect(() => {
    conversation.setMediaElements({
      videoElement: videoRef.current,
      audioElement: audioRef.current
    });
    return () => {
      conversation.setMediaElements({ videoElement: null, audioElement: null });
    };
  }, [conversation]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !crop) return undefined;

    canvas.width = crop.outputWidth;
    canvas.height = crop.outputHeight;
    let animationFrame: number | null = null;
    let videoFrameHandle: number | null = null;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const frame = cropAvatarFrame(video, crop);
      if (frame) {
        canvas.getContext("2d")?.drawImage(
          video,
          frame.sourceX,
          frame.sourceY,
          frame.sourceWidth,
          frame.sourceHeight,
          0,
          0,
          crop.outputWidth,
          crop.outputHeight
        );
      }
    };

    const schedule = () => {
      if (cancelled) return;
      draw();
      if (video.requestVideoFrameCallback) {
        videoFrameHandle = video.requestVideoFrameCallback(() => schedule());
      } else {
        animationFrame = requestAnimationFrame(schedule);
      }
    };

    schedule();
    return () => {
      cancelled = true;
      if (videoFrameHandle !== null) video.cancelVideoFrameCallback?.(videoFrameHandle);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [crop]);

  return createElement(
    "div",
    { className, style: { ...containerCropStyle(aspectRatio), ...style } },
    crop
      ? createElement("canvas", {
          ref: canvasRef,
          "aria-label": "Protoface avatar video",
          style: croppedCanvasStyle
        })
      : null,
    createElement("video", {
      ref: videoRef,
      "aria-label": crop ? "Protoface source avatar video" : "Protoface avatar video",
      autoPlay: true,
      playsInline: true,
      style: crop ? hiddenCropVideoStyle : undefined
    }),
    createElement("audio", {
      ref: audioRef,
      "aria-label": "Protoface avatar audio",
      autoPlay: true
    })
  );
}

type AvatarCrop = {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
};

type CropFrame = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

function containerCropStyle(aspectRatio: string | null): React.CSSProperties {
  if (!aspectRatio) return {};
  return {
    aspectRatio,
    position: "relative",
    overflow: "hidden"
  };
}

const croppedCanvasStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%"
};

const hiddenCropVideoStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  visibility: "hidden",
  pointerEvents: "none"
};

function avatarCrop(config: ManagedConversationConfig | null): AvatarCrop | null {
  const width = config?.source_width;
  const height = config?.source_height;
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return null;

  return {
    sourceWidth: width,
    sourceHeight: height,
    outputWidth: width,
    outputHeight: height
  };
}

function cropAvatarFrame(video: HTMLVideoElement, crop: AvatarCrop): CropFrame | null {
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
  if (!frameWidth || !frameHeight) return null;

  const sourceRatio = crop.sourceWidth / crop.sourceHeight;
  const frameRatio = frameWidth / frameHeight;
  if (sourceRatio >= frameRatio) {
    const sourceHeight = frameWidth / sourceRatio;
    return {
      sourceX: 0,
      sourceY: (frameHeight - sourceHeight) / 2,
      sourceWidth: frameWidth,
      sourceHeight
    };
  }

  const sourceWidth = frameHeight * sourceRatio;
  return {
    sourceX: (frameWidth - sourceWidth) / 2,
    sourceY: 0,
    sourceWidth,
    sourceHeight: frameHeight
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
