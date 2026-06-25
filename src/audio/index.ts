export type StopListening = () => void;

export interface AudioSource {
  listenToMediaStreamTrack(
    track: MediaStreamTrack,
    onChunk: (chunk: Uint8Array) => Promise<void> | void
  ): Promise<StopListening>;
}

export type AudioSourceFactory = () => AudioSource;

export interface WebAudioPcmSourceOptions {
  sampleRate?: number;
  chunkSize?: number;
}

export class WebAudioPcmSource implements AudioSource {
  private readonly sampleRate: number;
  private readonly chunkSize: number;

  constructor(options: WebAudioPcmSourceOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16_000;
    this.chunkSize = options.chunkSize ?? 4_096;
  }

  async listenToMediaStreamTrack(
    track: MediaStreamTrack,
    onChunk: (chunk: Uint8Array) => Promise<void> | void
  ): Promise<StopListening> {
    const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio is not available in this browser.");
    }

    const context = new AudioContextCtor({ sampleRate: this.sampleRate });
    const stream = new MediaStream([track]);
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(this.chunkSize, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      void onChunk(float32ToPcm16(input));
    };

    source.connect(processor);
    processor.connect(context.destination);

    return () => {
      processor.disconnect();
      source.disconnect();
      void context.close();
    };
  }
}

export function float32ToPcm16(input: Float32Array): Uint8Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(output.buffer);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  var webkitAudioContext: typeof AudioContext | undefined;
}
