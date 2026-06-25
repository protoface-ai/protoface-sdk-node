import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProtofaceClient } from "./client";
import type { StopListening } from "./audio";
import type { ProtofaceClientOptions, ProtofaceClientStatus } from "./types";

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
