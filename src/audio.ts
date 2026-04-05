import { spawn } from "child_process";
import { mulaw } from "alawmulaw";

/**
 * Decode a base64-encoded mulaw payload (from Twilio) to 16-bit PCM.
 */
export function mulawDecode(base64Payload: string): Int16Array {
  const raw = Buffer.from(base64Payload, "base64");
  return mulaw.decode(new Uint8Array(raw));
}

/**
 * Encode 16-bit PCM samples to mulaw Buffer.
 */
export function mulawEncode(pcm: Int16Array): Buffer {
  const encoded = mulaw.encode(pcm);
  return Buffer.from(encoded);
}

/**
 * Calculate RMS energy of PCM samples. Used for voice activity detection.
 */
export function calculateRMS(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Resample PCM via linear interpolation.
 */
export function resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    output[i] = Math.round(input[low] * (1 - frac) + input[high] * frac);
  }
  return output;
}

/**
 * Wrap raw PCM samples in a WAV header (16-bit mono).
 */
export function pcmToWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  // Write PCM data
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

/**
 * Decode MP3 buffer to 8kHz mono 16-bit PCM via ffmpeg.
 */
export function decodeMp3(mp3Buffer: Buffer): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      "-ar", "8000",
      "-ac", "1",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
      resolve(pcm);
    });

    proc.on("error", reject);

    proc.stdin.write(mp3Buffer);
    proc.stdin.end();
  });
}
