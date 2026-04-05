import { config } from "./config.js";

/**
 * Synthesize text to speech via Kokoro on Lemonade. Returns raw MP3 buffer.
 */
export async function synthesize(text: string): Promise<Buffer> {
  const url = `${config.LEMONADE_URL.replace(/\/$/, "")}/audio/speech`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.TTS_MODEL,
        voice: config.TTS_VOICE,
        input: text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TTS request failed (${response.status}): ${body}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
