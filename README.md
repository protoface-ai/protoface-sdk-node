# Protoface Node Plugin

Browser and React SDK for adding a realtime talking avatar to a voice AI app.

The Protoface Node Plugin handles the realtime connection, media element binding, audio streaming, and avatar playback controls. It works with audio from most TTS providers, including Vapi, ElevenLabs, Retell, OpenAI Realtime, LiveKit Agents, and more.

## About Protoface

Protoface adds a real-time avatar to your AI app or agent.

Get a **free** API key at [protoface.com](https://protoface.com/?utm_source=github&utm_medium=referral&utm_campaign=github_docs&utm_content=protoface-plugin-node).

Read the docs at [docs.protoface.com](https://docs.protoface.com/?utm_source=github&utm_medium=referral&utm_campaign=github_docs&utm_content=protoface-plguin-node).

## Get Started

The fastest way to build with Protoface is to start from an example:

[Visit the Protoface quickstart repo](https://github.com/protoface-ai/protoface-quickstart)

The examples show complete app setups for common voice providers, including LiveKit token routes, React components, and provider-specific audio wiring.

## Installation

```bash
npm install protoface-client
```

## Direct SDK Usage

Use this package directly when you want to wire Protoface into an existing LiveKit app or build a custom voice-provider integration.

To start a real Protoface session, the client needs:

- a Protoface API key
- the avatar ID to render
- the LiveKit room URL and room name
- a browser participant token for this user
- a worker token that lets the Protoface avatar participant join the same room

For local prototypes, you can pass a Protoface API key directly to `ProtofaceClient`. For production apps, keep your Protoface API key and LiveKit API secret on your application server, then return short-lived room tokens or a signed connection url to the browser.

```tsx
import { useRef, useState } from "react";
import { ProtofaceClient } from "protoface-client";

export function AvatarDemo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [client, setClient] = useState<ProtofaceClient | null>(null);

  async function start() {
    const tokens = await fetch("/api/livekit-token").then((res) => res.json());

    const protoface = new ProtofaceClient({
      // Prototype only: do not expose a live API key in production browser code.
      apiKey: "sk_live_...",
      avatarId: "av_stock_001",
      livekitUrl: tokens.livekitUrl,
      roomName: tokens.roomName,
      participantToken: tokens.participantToken,
      workerToken: tokens.workerToken,
      workerIdentity: "protoface-avatar-agent",
      maxDurationSeconds: 600,
      videoElement: videoRef.current,
      audioElement: audioRef.current
    });

    protoface.on("start", ({ sessionId }) => console.log("avatar started", sessionId));
    protoface.on("error", ({ error }) => console.error(error));

    await protoface.start();
    setClient(protoface);
  }

  return (
    <>
      <video ref={videoRef} autoPlay playsInline />
      <audio ref={audioRef} autoPlay />
      <button onClick={start}>Start avatar</button>
      <button onClick={() => client?.close()}>Stop</button>
    </>
  );
}
```

## React Hook

For React apps, `useProtofaceClient` wraps the same client lifecycle in a hook.

```tsx
import { useProtofaceClient } from "protoface-client/react";

const {
  start,
  stop,
  sendAudioData,
  listenToMediaStreamTrack,
  clearBuffer,
  status,
  error
} = useProtofaceClient({
  apiKey: "sk_live_...",
  avatarId: "av_stock_001",
  livekitUrl,
  roomName,
  participantToken,
  workerToken,
  videoRef,
  audioRef
});
```

Call `start()` after your refs are mounted. The hook refreshes the media elements immediately before connecting, so it works with normal React render timing.

## Production Token Routes

For production apps, create a small server route that returns the LiveKit values the browser needs:

```json
{
  "livekitUrl": "wss://your-realtime-url.example",
  "roomName": "room_123",
  "participantToken": "viewer_connection_token",
  "workerToken": "avatar_worker_token"
}
```

Recommended route behavior:

1. Verify the current user is allowed to start an avatar session.
2. Create a short-lived browser participant token for your LiveKit room.
3. Create a short-lived worker token for the Protoface avatar to join the room.
4. Return those values to the browser, then let `ProtofaceClient` create the Protoface session with `apiKey`, `avatarId`, and the returned LiveKit values.

## Voice Provider Integration

Use streamed audio bytes or a browser audio track. Audio passed to `sendAudioData` should be PCM16, 16 kHz, mono.

### Generic PCM16 Stream

```ts
await client.start();

for await (const pcm16Chunk of audioStream) {
  await client.sendAudioData(pcm16Chunk);
}
```

### ElevenLabs

Stream ElevenLabs TTS output as PCM16 16 kHz mono, then send each chunk:

```ts
for await (const pcm16Chunk of elevenLabsPcm16Stream) {
  await client.sendAudioData(pcm16Chunk);
}
```

If your ElevenLabs stream uses MP3, Opus, or another compressed format, decode or transcode it to PCM16 before calling `sendAudioData`.

### Vapi / Retell / WebRTC Voice Providers

If your provider exposes a browser audio `MediaStreamTrack`, pass it directly:

```ts
const cleanup = await client.listenToMediaStreamTrack(providerAudioTrack);

// Later, when the call ends:
cleanup();
```

If your provider exposes audio bytes instead, use `sendAudioData`.

### Custom Transports

LiveKit is the only built-in transport. If you need a different realtime transport, pass your own `transportFactory`.

```ts
import { ProtofaceClient } from "protoface-client";
import type { ProtofaceTransport } from "protoface-client";

class CustomTransport implements ProtofaceTransport {
  async connect() {
    // Open your transport and attach avatar media to the page.
  }

  async disconnect() {
    // Close your transport.
  }

  async sendAudioData(audioData: Uint8Array) {
    // Send PCM16 16 kHz mono audio to the avatar over your transport.
  }

  async sendControlMessage(type: string) {
    if (type === "clear_buffer") {
      // Cancel queued speech in your transport.
    }
  }
}

const client = new ProtofaceClient({
  transportFactory: () => new CustomTransport()
});
```

The core package does not include provider-specific transports beyond LiveKit.

### Barge-In / Stop Speaking

When the user interrupts the assistant or you cancel the current utterance:

```ts
await client.clearBuffer();
```

## API Reference

### Methods

- `new ProtofaceClient(config)`: Creates a browser client.
- `start()`: Connects the avatar session and attaches remote media to your video/audio elements.
- `stop()`: Disconnects and releases media-track listeners.
- `close()`: Alias for `stop()`.
- `sendAudioData(audioData: Uint8Array)`: Sends PCM16 audio to the avatar.
- `listenToMediaStreamTrack(track: MediaStreamTrack)`: Captures a browser audio track, converts it to PCM16, and streams it to the avatar.
- `listenToMediastreamTrack(track: MediaStreamTrack)`: Compatibility alias.
- `clearBuffer()`: Stops queued avatar speech as quickly as possible.
- `ClearBuffer()`: Compatibility alias.
- `setMediaElements({ videoElement, audioElement })`: Rebinds media elements before start or after a React ref changes.
- `on(event, callback)`: Subscribes to typed client events.

### Events

- `start`: Avatar session connected.
- `stop`: Client disconnected.
- `error`: Runtime or connection error.
- `startup_error`: Startup failed before the avatar connected.
- `ack`: Audio chunk accepted for sending.
- `speaking`: Avatar started speaking.
- `silent`: Avatar stopped speaking or buffer was cleared.
- `connection_info`: Realtime room and connection metadata.
- `video_info`: Video dimensions/FPS when available.
- `destination`: Debug destination info.
- `unknown`: Forward-compatible message.

```ts
client.on("ack", ({ bytes }) => console.log("sent", bytes));
client.on("silent", () => console.log("avatar is quiet"));
```

### Types

```ts
interface ProtofaceClientOptions {
  apiKey: string;
  avatarId: string;
  livekitUrl: string;
  roomName: string;
  participantToken: string;
  workerToken: string;
  workerIdentity?: string;
  maxDurationSeconds?: number;
  idleTimeoutSeconds?: number;
  videoElement?: HTMLVideoElement | null;
  audioElement?: HTMLAudioElement | null;
}
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```
