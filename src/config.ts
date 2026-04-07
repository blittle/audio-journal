import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const serverConfigSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_PHONE_NUMBER: z.string().min(1, "TWILIO_PHONE_NUMBER is required"),

  WEBHOOK_URL: z.string().url("WEBHOOK_URL must be a valid URL"),

  LEMONADE_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:8000/api/v1"),

  STT_MODEL: z.string().default("Whisper-Large-v3"),
  TTS_MODEL: z.string().default("kokoro-v1"),
  TTS_VOICE: z.string().default("af_heart"),
  LLM_MODEL: z.string().default("Qwen3.5-4B-GGUF"),

  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  SUMMARIZE_MODEL: z.string().optional(),
  SUMMARIZE_LLM_BASE_URL: z.string().url().optional(),
  SUMMARIZE_LLM_API_KEY: z.string().optional(),

  SILENCE_THRESHOLD_MS: z.coerce.number().default(3000),

  API_KEY: z.string().optional(),
  KNOWN_NAMES: z.string().optional(),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().default(30),

  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3000),

  // Single-user shortcut — auto-creates a default user if set
  PHONE_NUMBER: z.string().optional(),
  CALL_TIME: z.string().default("20:00"),
  TIMEZONE: z.string().default("America/Denver"),
  CONVERSATION_STYLE: z
    .enum(["casual", "reflective", "structured"])
    .default("casual"),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

function loadConfig(): ServerConfig {
  const result = serverConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
