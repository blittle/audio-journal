import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import os from "os";
import express from "express";
import { mulaw } from "alawmulaw";
import { spawn } from "child_process";

// Mock twilio so callSid validation passes with fake SIDs
vi.mock("twilio", () => ({
  default: () => ({
    calls: () => ({ fetch: vi.fn().mockResolvedValue({ sid: "CA-fake" }) }),
  }),
}));

/**
 * End-to-end tests simulating Twilio media stream calls.
 * Requires Lemonade running locally with Whisper, Kokoro, and Qwen3.5-4B loaded.
 * Run with: npx vitest run tests/e2e.test.ts
 */

const LEMONADE_URL = "http://127.0.0.1:8000/api/v1";
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-journal-"));
const TEST_USER_ID = "e2e-test";
const STREAM_SID = "MZ-e2e-test-001";

// Set env vars BEFORE any src/ imports happen
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_PHONE_NUMBER = "+15550000000";
process.env.WEBHOOK_URL = "http://localhost:3999";
process.env.LEMONADE_URL = LEMONADE_URL;
process.env.LLM_BASE_URL = LEMONADE_URL;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.SILENCE_THRESHOLD_MS = "800";
process.env.LLM_MODEL = "Qwen3.5-4B-GGUF";
process.env.PHONE_NUMBER = "+15551234567";

// --- Helpers ---

async function generateSpeechMulaw(text: string): Promise<Buffer[]> {
  const res = await fetch(`${LEMONADE_URL}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro-v1", voice: "af_heart", input: text }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  const mp3 = Buffer.from(await res.arrayBuffer());

  const pcm8k = await new Promise<Int16Array>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", "pipe:0", "-f", "s16le", "-ar", "8000", "-ac", "1", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
      const raw = Buffer.concat(chunks);
      resolve(new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2));
    });
    proc.stdin.write(mp3);
    proc.stdin.end();
  });

  const encoded = mulaw.encode(pcm8k);
  const chunkSize = 160;
  const result: Buffer[] = [];
  for (let i = 0; i < encoded.length; i += chunkSize) {
    result.push(Buffer.from(encoded.subarray(i, i + chunkSize)));
  }
  return result;
}

function silenceChunks(count: number): Buffer[] {
  return Array.from({ length: count }, () => Buffer.alloc(160, 0xFF));
}

/** Connect a WebSocket and send the Twilio handshake. Returns ws + collected messages. */
async function connectCall(port: number, callSid: string): Promise<{
  ws: WebSocket;
  received: any[];
}> {
  const ws = new WebSocket(`ws://localhost:${port}/media-stream`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  const received: any[] = [];
  ws.on("message", (data) => {
    try { received.push(JSON.parse(data.toString())); } catch {}
  });

  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({
    event: "start",
    sequenceNumber: "1",
    start: {
      accountSid: "ACtest",
      streamSid: STREAM_SID,
      callSid,
      tracks: ["inbound"],
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      customParameters: { userId: TEST_USER_ID },
    },
    streamSid: STREAM_SID,
  }));

  // Wait for opener
  await new Promise((r) => setTimeout(r, 5000));

  return { ws, received };
}

/** Send speech audio followed by silence to trigger a turn. */
async function speakAndWait(ws: WebSocket, text: string, waitMs = 15000): Promise<void> {
  const speech = await generateSpeechMulaw(text);
  for (const chunk of speech) {
    ws.send(JSON.stringify({
      event: "media",
      sequenceNumber: "2",
      media: { track: "inbound_track", chunk: "1", timestamp: "0", payload: chunk.toString("base64") },
      streamSid: STREAM_SID,
    }));
  }

  // Silence to trigger turn processing
  for (const chunk of silenceChunks(60)) {
    ws.send(JSON.stringify({
      event: "media",
      sequenceNumber: "3",
      media: { track: "inbound_track", chunk: "2", timestamp: "0", payload: chunk.toString("base64") },
      streamSid: STREAM_SID,
    }));
  }

  await new Promise((r) => setTimeout(r, waitMs));
}

function sendStop(ws: WebSocket, callSid: string): void {
  ws.send(JSON.stringify({
    event: "stop",
    sequenceNumber: "100",
    stop: { accountSid: "ACtest", callSid },
    streamSid: STREAM_SID,
  }));
}

async function waitForFile(dir: string, ext: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext));
      if (files.length > 0) return path.join(dir, files[0]);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function journalFiles(): string[] {
  if (!fs.existsSync(journalDir)) return [];
  return fs.readdirSync(journalDir).filter((f) => f.endsWith(".md"));
}

let journalDir: string;

// --- Test suite ---

describe("end-to-end call simulation", () => {
  let server: http.Server;
  let port: number;
  let callCounter = 0;

  function nextCallSid(): string {
    return `CA-e2e-test-${++callCounter}`;
  }

  beforeAll(async () => {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(TEST_DATA_DIR, "users.json"),
      JSON.stringify([{
        id: TEST_USER_ID,
        phoneNumber: "+15551234567",
        callTime: "20:00",
        timezone: "America/Denver",
        conversationStyle: "casual",
        enabled: true,
      }])
    );
    journalDir = path.join(TEST_DATA_DIR, "journals", TEST_USER_ID);

    const { attachMediaStreamHandler } = await import("../src/media-stream.js");

    const app = express();
    server = http.createServer(app);
    attachMediaStreamHandler(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  beforeEach(() => {
    // Clean journal dir between tests
    if (fs.existsSync(journalDir)) {
      fs.rmSync(journalDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it(
    "full conversation generates a journal entry",
    { timeout: 120_000 },
    async () => {
      const callSid = nextCallSid();
      const { ws, received } = await connectCall(port, callSid);

      // Verify opener was sent
      expect(received.filter((m) => m.event === "media").length).toBeGreaterThan(0);

      // User speaks (turn 1)
      await speakAndWait(ws, "I had a really good day today. I went for a long walk in the park and the weather was beautiful.");

      // Verify assistant responded
      expect(received.filter((m) => m.event === "media").length).toBeGreaterThan(100);

      // User speaks again (turn 2 — needed for journal generation)
      await speakAndWait(ws, "That's about it for today. I'm done.");

      // End call
      sendStop(ws, callSid);
      console.log("  Waiting for journal...");
      const journalPath = await waitForFile(journalDir, ".md", 60_000);
      expect(journalPath, "Journal file should be created").not.toBeNull();

      const journal = fs.readFileSync(journalPath!, "utf-8");
      expect(journal).toContain("Journal");
      expect(journal).toContain("Summary");
      const lower = journal.toLowerCase();
      expect(lower.includes("walk") || lower.includes("park") || lower.includes("weather")).toBe(true);

      console.log("  ✓ Journal generated with user's content");
      ws.close();
    }
  );

  it(
    "wrap-up phrase ('I\\'m done') ends call but still generates journal",
    { timeout: 120_000 },
    async () => {
      const callSid = nextCallSid();
      const { ws } = await connectCall(port, callSid);

      // User talks about their day, then says "I'm done"
      await speakAndWait(ws, "Work was stressful today. We had a big deadline and I barely made it.");
      await speakAndWait(ws, "I'm done.");

      // Wait for ws to close (wrap-up triggers close after 5s)
      await new Promise((r) => setTimeout(r, 8000));

      // Journal should be generated
      const journalPath = await waitForFile(journalDir, ".md", 60_000);
      expect(journalPath, "Journal should be created after wrap-up phrase").not.toBeNull();

      const journal = fs.readFileSync(journalPath!, "utf-8");
      const lower = journal.toLowerCase();
      expect(lower.includes("stressful") || lower.includes("deadline") || lower.includes("work")).toBe(true);

      console.log("  ✓ Wrap-up phrase ended call, journal still generated");
      ws.close();
    }
  );

  it(
    "callback phrase ('call me back') ends call without generating journal",
    { timeout: 120_000 },
    async () => {
      const callSid = nextCallSid();
      const { ws, received } = await connectCall(port, callSid);

      // User immediately asks to call back
      await speakAndWait(ws, "Not a good time. Call me back in an hour.");

      // Wait for ws to close
      await new Promise((r) => setTimeout(r, 8000));

      // Verify assistant said something about calling back
      const audioAfterOpener = received.filter((m) => m.event === "media");
      expect(audioAfterOpener.length).toBeGreaterThan(0);

      // Journal should NOT be generated
      const files = journalFiles();
      expect(files.length, "No journal should be created for callback phrase").toBe(0);

      console.log("  ✓ Callback phrase ended call, no journal generated");
      ws.close();
    }
  );

  it(
    "skip phrase ('skip today') ends call without generating journal",
    { timeout: 120_000 },
    async () => {
      const callSid = nextCallSid();
      const { ws } = await connectCall(port, callSid);

      // User says skip
      await speakAndWait(ws, "Skip today.");

      // Wait for ws to close
      await new Promise((r) => setTimeout(r, 8000));

      // Journal should NOT be generated
      const files = journalFiles();
      expect(files.length, "No journal should be created for skip phrase").toBe(0);

      console.log("  ✓ Skip phrase ended call, no journal generated");
      ws.close();
    }
  );

  it(
    "voicemail greeting (single turn) does not generate a journal",
    { timeout: 120_000 },
    async () => {
      const callSid = nextCallSid();
      const { ws } = await connectCall(port, callSid);

      // Simulate voicemail: only one "user" turn (the voicemail greeting)
      await speakAndWait(ws,
        "The wireless subscriber you are trying to reach is unavailable. Please leave a message after the tone."
      );

      // Call ends (voicemail hangs up or Twilio timeout)
      sendStop(ws, callSid);
      await new Promise((r) => setTimeout(r, 10000));

      // Journal should NOT be generated — only 1 user turn
      const files = journalFiles();
      expect(files.length, "No journal should be created for voicemail greeting").toBe(0);

      console.log("  ✓ Voicemail greeting did not generate a journal");
      ws.close();
    }
  );

  it(
    "multiple calls on same day append to the same journal file",
    { timeout: 180_000 },
    async () => {
      // --- First call ---
      const callSid1 = nextCallSid();
      const { ws: ws1 } = await connectCall(port, callSid1);

      await speakAndWait(ws1, "This morning I went to the grocery store and bought some apples.");
      await speakAndWait(ws1, "That's all for now. I'm done.");
      sendStop(ws1, callSid1);

      const journalPath = await waitForFile(journalDir, ".md", 60_000);
      expect(journalPath).not.toBeNull();
      const firstContent = fs.readFileSync(journalPath!, "utf-8");
      ws1.close();

      // --- Second call ---
      await new Promise((r) => setTimeout(r, 3000));
      const callSid2 = nextCallSid();
      const { ws: ws2 } = await connectCall(port, callSid2);

      await speakAndWait(ws2, "In the evening I watched a movie with my family. It was a comedy.");
      await speakAndWait(ws2, "That's it. Goodbye.");
      sendStop(ws2, callSid2);

      // Wait for second journal to be appended
      await new Promise((r) => setTimeout(r, 20000));

      // Should still be one file, but with both entries
      const files = journalFiles();
      expect(files.length).toBe(1);

      const fullContent = fs.readFileSync(path.join(journalDir, files[0]), "utf-8");

      // Should contain separator
      expect(fullContent).toContain("---");

      // Should contain content from both calls
      const lower = fullContent.toLowerCase();
      expect(lower.includes("grocer") || lower.includes("apple")).toBe(true);
      expect(lower.includes("movie") || lower.includes("comedy") || lower.includes("evening")).toBe(true);

      // Second entry should be longer than the first (appended)
      expect(fullContent.length).toBeGreaterThan(firstContent.length);

      console.log("  ✓ Two calls appended to same journal file");
      ws2.close();
    }
  );
});
