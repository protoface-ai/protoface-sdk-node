# Protoface Client

NodeJS and React SDK for adding a realtime Protoface avatar to any voice AI web app.

## About Protoface

Protoface adds a real-time avatar to your AI app or agent.

Get a **free** API key at [protoface.com](https://protoface.com/?utm_source=github&utm_medium=referral&utm_campaign=github_docs&utm_content=protoface-client).

Read the docs at [docs.protoface.com](https://docs.protoface.com/?utm_source=github&utm_medium=referral&utm_campaign=github_docs&utm_content=protoface-client).

To see complete app examples for OpenAI Realtime, Vapi, ElevenLabs, Agora, and other providers, visit the [quickstart repo](https://github.com/protoface-ai/protoface-quickstart).

## Installation

```bash
npm install protoface-client
```

## Usage

Create a client with your Protoface avatar details and LiveKit room credentials, then start the session after your media elements are mounted.

```ts
import { ProtofaceClient } from "protoface-client";

const client = new ProtofaceClient({
  apiKey: "PROTOFACE-API-KEY",
  avatarId: "av_stock_001",
  livekitUrl: "wss://YOUR-LIVEKIT-PROJECT.livekit.cloud",
  roomName: "room_123",
  participantToken: "BROWSER-PARTICIPANT-TOKEN",
  workerToken: "PROTOFACE-WORKER-TOKEN",
  videoElement,
  audioElement
});

await client.start();
```

Keep API keys and LiveKit secrets on your server in production. The browser should receive short-lived room credentials from your own route.

## React

React apps can use the hook export for the same client lifecycle.

```ts
import { useProtofaceClient } from "protoface-client/react";
```

The hook exposes `start`, `stop`, `sendAudioData`, `listenToMediaStreamTrack`, `clearBuffer`, `status`, and `error`.

## How It Works

The package connects a browser app to a Protoface avatar session:

1. Your server creates or returns the LiveKit room credentials.
2. `ProtofaceClient.start()` connects the browser to the avatar session.
3. Your voice provider produces assistant audio.
4. The app passes that audio to Protoface so the avatar speaks naturally.

Audio bytes sent with `sendAudioData` should be PCM16, 16 kHz, mono. If your provider exposes a browser `MediaStreamTrack`, pass it to `listenToMediaStreamTrack`.