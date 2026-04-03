import { describe, it, expect, vi } from "vitest";

// Mock all dependencies before importing server
vi.mock("../src/config.js", () => ({
  config: {
    TWILIO_ACCOUNT_SID: "ACtest123",
    TWILIO_AUTH_TOKEN: "auth-token-123",
    TWILIO_PHONE_NUMBER: "+15550001111",
    WEBHOOK_URL: "https://example.com",
    LEMONADE_URL: "http://127.0.0.1:8000/api/v1",
    STT_MODEL: "Whisper-Large-v3-Turbo",
    TTS_MODEL: "kokoro-v1",
    TTS_VOICE: "af_heart",
    LLM_MODEL: "Qwen3.5-35B-A3B-GGUF",
    SILENCE_THRESHOLD_MS: 1500,
    DATA_DIR: "/tmp/test-data",
    PORT: 3000,
    CALL_TIME: "20:00",
    TIMEZONE: "America/Denver",
    CONVERSATION_STYLE: "casual",
  },
}));

vi.mock("twilio", () => ({
  default: () => ({
    calls: () => ({ update: vi.fn() }),
  }),
}));

vi.mock("../src/twilio.js", () => ({
  triggerCall: vi.fn().mockResolvedValue("CA-call-123"),
}));

vi.mock("../src/journal.js", () => ({
  generateJournal: vi.fn().mockResolvedValue("/tmp/test.md"),
}));

vi.mock("../src/users.js", () => ({
  sanitizeUserId: vi.fn((id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid userId");
    return id;
  }),
  getAllUsers: vi.fn().mockReturnValue([
    {
      id: "test-user",
      phoneNumber: "+15551234567",
      callTime: "20:00",
      timezone: "America/Denver",
      conversationStyle: "casual",
      enabled: true,
    },
  ]),
  getUser: vi.fn().mockReturnValue({
    id: "test-user",
    phoneNumber: "+15551234567",
    callTime: "20:00",
    timezone: "America/Denver",
    conversationStyle: "casual",
    enabled: true,
  }),
}));

import { app } from "../src/server.js";
import { triggerCall } from "../src/twilio.js";

// Simple request helper using the express app directly
async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const { createServer } = require("http");
    const server = createServer(app);
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const url = `http://localhost:${port}${path}`;
      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body) options.body = JSON.stringify(body);

      fetch(url, options)
        .then(async (res) => {
          let data: unknown;
          try {
            data = await res.json();
          } catch {
            data = null;
          }
          server.close();
          resolve({ status: res.status, body: data });
        })
        .catch(() => {
          server.close();
          resolve({ status: 500, body: null });
        });
    });
  });
}

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await request("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", users: 1 });
  });
});

describe("POST /trigger", () => {
  it("triggers a call and returns call ID", async () => {
    const res = await request("POST", "/trigger");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ callId: "CA-call-123", userId: "test-user" });
    expect(triggerCall).toHaveBeenCalledWith("test-user");
  });
});

describe("POST /trigger/:userId", () => {
  it("triggers a call for a specific user", async () => {
    const res = await request("POST", "/trigger/test-user");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ callId: "CA-call-123", userId: "test-user" });
    expect(triggerCall).toHaveBeenCalledWith("test-user");
  });
});
