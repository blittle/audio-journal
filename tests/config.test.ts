import { describe, it, expect } from "vitest";
import { z } from "zod";

// We can't import config directly (it calls process.exit on failure),
// so we test the schema validation logic independently.

const serverConfigSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_PHONE_NUMBER: z.string().min(1, "TWILIO_PHONE_NUMBER is required"),

  WEBHOOK_URL: z.string().url("WEBHOOK_URL must be a valid URL"),

  LEMONADE_URL: z.string().url().default("http://127.0.0.1:8000/api/v1"),

  STT_MODEL: z.string().default("Whisper-Large-v3-Turbo"),
  TTS_MODEL: z.string().default("kokoro-v1"),
  TTS_VOICE: z.string().default("af_heart"),
  LLM_MODEL: z.string().default("Qwen3.5-35B-A3B-GGUF"),

  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  SUMMARIZE_MODEL: z.string().optional(),
  SUMMARIZE_LLM_BASE_URL: z.string().url().optional(),
  SUMMARIZE_LLM_API_KEY: z.string().optional(),

  SILENCE_THRESHOLD_MS: z.coerce.number().default(1500),

  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3000),

  PHONE_NUMBER: z.string().optional(),
  CALL_TIME: z.string().default("20:00"),
  TIMEZONE: z.string().default("America/Denver"),
  CONVERSATION_STYLE: z
    .enum(["casual", "reflective", "structured"])
    .default("casual"),
});

describe("config schema validation", () => {
  const validEnv = {
    TWILIO_ACCOUNT_SID: "ACtest123",
    TWILIO_AUTH_TOKEN: "auth-token-123",
    TWILIO_PHONE_NUMBER: "+15551234567",
    WEBHOOK_URL: "https://example.com",
  };

  it("accepts valid minimal config", () => {
    const result = serverConfigSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it("applies defaults correctly", () => {
    const result = serverConfigSchema.parse(validEnv);
    expect(result.PORT).toBe(3000);
    expect(result.DATA_DIR).toBe("./data");
    expect(result.CALL_TIME).toBe("20:00");
    expect(result.TIMEZONE).toBe("America/Denver");
    expect(result.CONVERSATION_STYLE).toBe("casual");
    expect(result.LEMONADE_URL).toBe("http://127.0.0.1:8000/api/v1");
    expect(result.STT_MODEL).toBe("Whisper-Large-v3-Turbo");
    expect(result.TTS_MODEL).toBe("kokoro-v1");
    expect(result.TTS_VOICE).toBe("af_heart");
    expect(result.LLM_MODEL).toBe("Qwen3.5-35B-A3B-GGUF");
    expect(result.SILENCE_THRESHOLD_MS).toBe(1500);
  });

  it("rejects missing TWILIO_ACCOUNT_SID", () => {
    const { TWILIO_ACCOUNT_SID, ...rest } = validEnv;
    const result = serverConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing TWILIO_AUTH_TOKEN", () => {
    const { TWILIO_AUTH_TOKEN, ...rest } = validEnv;
    const result = serverConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing TWILIO_PHONE_NUMBER", () => {
    const { TWILIO_PHONE_NUMBER, ...rest } = validEnv;
    const result = serverConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing WEBHOOK_URL", () => {
    const { WEBHOOK_URL, ...rest } = validEnv;
    const result = serverConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid WEBHOOK_URL", () => {
    const result = serverConfigSchema.safeParse({
      ...validEnv,
      WEBHOOK_URL: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid CONVERSATION_STYLE", () => {
    const result = serverConfigSchema.safeParse({
      ...validEnv,
      CONVERSATION_STYLE: "aggressive",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid CONVERSATION_STYLE values", () => {
    for (const style of ["casual", "reflective", "structured"]) {
      const result = serverConfigSchema.safeParse({
        ...validEnv,
        CONVERSATION_STYLE: style,
      });
      expect(result.success).toBe(true);
    }
  });

  it("coerces PORT from string to number", () => {
    const result = serverConfigSchema.parse({
      ...validEnv,
      PORT: "8080",
    });
    expect(result.PORT).toBe(8080);
  });

  it("coerces SILENCE_THRESHOLD_MS from string to number", () => {
    const result = serverConfigSchema.parse({
      ...validEnv,
      SILENCE_THRESHOLD_MS: "2000",
    });
    expect(result.SILENCE_THRESHOLD_MS).toBe(2000);
  });

  it("accepts optional LLM config", () => {
    const result = serverConfigSchema.parse({
      ...validEnv,
      LLM_BASE_URL: "http://localhost:1234/v1",
      LLM_API_KEY: "sk-test",
    });
    expect(result.LLM_BASE_URL).toBe("http://localhost:1234/v1");
    expect(result.LLM_API_KEY).toBe("sk-test");
  });

  it("rejects invalid LLM_BASE_URL", () => {
    const result = serverConfigSchema.safeParse({
      ...validEnv,
      LLM_BASE_URL: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("accepts single-user shortcut vars", () => {
    const result = serverConfigSchema.parse({
      ...validEnv,
      PHONE_NUMBER: "+15551234567",
      CALL_TIME: "21:30",
      TIMEZONE: "America/New_York",
      CONVERSATION_STYLE: "reflective",
    });
    expect(result.PHONE_NUMBER).toBe("+15551234567");
    expect(result.CALL_TIME).toBe("21:30");
    expect(result.TIMEZONE).toBe("America/New_York");
    expect(result.CONVERSATION_STYLE).toBe("reflective");
  });
});
