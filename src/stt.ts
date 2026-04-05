import { config } from "./config.js";

/**
 * Transcribe a WAV buffer using Whisper via Lemonade.
 */
export async function transcribe(wavBuffer: Buffer): Promise<string> {
  const url = `${config.LEMONADE_URL.replace(/\/$/, "")}/audio/transcriptions`;

  const formData = new FormData();
  formData.append("model", config.STT_MODEL);
  formData.append(
    "file",
    new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }),
    "audio.wav"
  );

  // Hint Whisper with known names so it gets spellings right
  if (config.KNOWN_NAMES) {
    formData.append("prompt", config.KNOWN_NAMES);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`STT request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { text?: string };
    if (!data.text) return "";
    return data.text.trim();
  } finally {
    clearTimeout(timeout);
  }
}
