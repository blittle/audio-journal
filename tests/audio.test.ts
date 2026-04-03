import { describe, it, expect } from "vitest";
import {
  mulawDecode,
  mulawEncode,
  toBase64Mulaw,
  calculateRMS,
  resample,
  pcmToWav,
} from "../src/audio.js";

describe("mulawDecode", () => {
  it("decodes base64 mulaw payload to PCM", () => {
    // Encode some known PCM, then decode and compare
    const pcm = new Int16Array([0, 1000, -1000, 5000, -5000]);
    const encoded = mulawEncode(pcm);
    const base64 = encoded.toString("base64");
    const decoded = mulawDecode(base64);
    expect(decoded.length).toBe(pcm.length);
    // mulaw is lossy, so we check approximate values
    for (let i = 0; i < pcm.length; i++) {
      expect(Math.abs(decoded[i] - pcm[i])).toBeLessThan(500);
    }
  });

  it("handles empty payload", () => {
    const decoded = mulawDecode(Buffer.alloc(0).toString("base64"));
    expect(decoded.length).toBe(0);
  });
});

describe("mulawEncode", () => {
  it("encodes PCM to mulaw Buffer", () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const encoded = mulawEncode(pcm);
    expect(encoded).toBeInstanceOf(Buffer);
    expect(encoded.length).toBe(pcm.length);
  });
});

describe("toBase64Mulaw", () => {
  it("returns a base64 string", () => {
    const pcm = new Int16Array([100, 200, 300]);
    const result = toBase64Mulaw(pcm);
    expect(typeof result).toBe("string");
    // Should be valid base64
    expect(Buffer.from(result, "base64").length).toBe(pcm.length);
  });
});

describe("calculateRMS", () => {
  it("returns 0 for empty samples", () => {
    expect(calculateRMS(new Int16Array(0))).toBe(0);
  });

  it("returns 0 for silence", () => {
    expect(calculateRMS(new Int16Array([0, 0, 0, 0]))).toBe(0);
  });

  it("calculates correct RMS for known values", () => {
    // RMS of [3, 4] = sqrt((9+16)/2) = sqrt(12.5) ≈ 3.536
    const rms = calculateRMS(new Int16Array([3, 4]));
    expect(rms).toBeCloseTo(3.536, 2);
  });

  it("returns higher RMS for louder audio", () => {
    const quiet = calculateRMS(new Int16Array([10, 10, 10]));
    const loud = calculateRMS(new Int16Array([10000, 10000, 10000]));
    expect(loud).toBeGreaterThan(quiet);
  });
});

describe("resample", () => {
  it("returns same data when rates are equal", () => {
    const input = new Int16Array([100, 200, 300]);
    const result = resample(input, 8000, 8000);
    expect(result).toBe(input); // same reference
  });

  it("upsamples correctly", () => {
    const input = new Int16Array([0, 1000]);
    const result = resample(input, 8000, 16000);
    expect(result.length).toBe(4);
  });

  it("downsamples correctly", () => {
    const input = new Int16Array([0, 100, 200, 300]);
    const result = resample(input, 16000, 8000);
    expect(result.length).toBe(2);
  });
});

describe("pcmToWav", () => {
  it("produces a valid WAV buffer with correct header", () => {
    const samples = new Int16Array([0, 1000, -1000, 5000]);
    const wav = pcmToWav(samples, 8000);

    // Check RIFF header
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");

    // Check fmt chunk
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(8000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample

    // Check data chunk
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(samples.length * 2);

    // Total size: 44 header + 8 data bytes
    expect(wav.length).toBe(44 + samples.length * 2);
  });
});
