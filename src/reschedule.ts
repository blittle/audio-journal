import { config } from "./config.js";
import { getUser } from "./users.js";

const DEFAULT_RETRY_MINUTES = 30;

interface ParsedCallback {
  minutes: number;
  displayTime: string;
}

/**
 * Use the LLM to extract a callback time from the user's message.
 * Returns minutes from now and a human-friendly display string.
 */
export async function parseCallbackTime(
  userText: string,
  timezone: string
): Promise<ParsedCallback> {
  const now = new Date();
  const nowLocal = now.toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const baseUrl = (config.LLM_BASE_URL ?? config.LEMONADE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.LLM_API_KEY) {
    headers["Authorization"] = `Bearer ${config.LLM_API_KEY}`;
  }

  const systemPrompt = `You extract callback times from user messages. The current time is ${nowLocal} (${timezone}).

Respond with ONLY a JSON object, no other text:
{"minutes": <number of minutes from now>, "display": "<friendly time string>"}

Examples:
- "call me back in an hour" → {"minutes": 60, "display": "in 1 hour"}
- "call back at 9" → {"minutes": <calculated>, "display": "at 9:00 PM"}
- "try again in 30 minutes" → {"minutes": 30, "display": "in 30 minutes"}
- "call me back this evening" → {"minutes": <calculated to ~7pm>, "display": "this evening around 7"}
- "not a good time" (no time specified) → {"minutes": 0, "display": ""}
- "call me back later" (no specific time) → {"minutes": 0, "display": ""}

If no specific time is mentioned, return minutes: 0. Only extract a time if the user clearly states one.`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        max_tokens: 80,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });

    if (!response.ok) {
      console.error(`Callback time parse failed: ${response.status}`);
      return { minutes: DEFAULT_RETRY_MINUTES, displayTime: `in ${DEFAULT_RETRY_MINUTES} minutes` };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices[0].message.content.trim();
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return { minutes: DEFAULT_RETRY_MINUTES, displayTime: `in ${DEFAULT_RETRY_MINUTES} minutes` };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { minutes: number; display: string };

    if (!parsed.minutes || parsed.minutes <= 0) {
      return { minutes: DEFAULT_RETRY_MINUTES, displayTime: `in ${DEFAULT_RETRY_MINUTES} minutes` };
    }

    return { minutes: parsed.minutes, displayTime: parsed.display || `in ${parsed.minutes} minutes` };
  } catch (err) {
    console.error("Failed to parse callback time:", err);
    return { minutes: DEFAULT_RETRY_MINUTES, displayTime: `in ${DEFAULT_RETRY_MINUTES} minutes` };
  }
}

// Active retry timers — keyed by userId to prevent stacking
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a retry call for a user after the given number of minutes.
 */
export function scheduleRetry(userId: string, minutes: number): void {
  // Cancel any existing retry for this user
  const existing = retryTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const ms = minutes * 60_000;
  console.log(`Scheduling retry call for ${userId} in ${minutes} minutes`);

  const timer = setTimeout(async () => {
    retryTimers.delete(userId);
    try {
      // Dynamic import to avoid circular dependency
      const { triggerCall } = await import("./twilio.js");
      console.log(`Retry: calling ${userId} now`);
      await triggerCall(userId);
    } catch (err) {
      console.error(`Retry call failed for ${userId}:`, err);
    }
  }, ms);

  retryTimers.set(userId, timer);
}

export function cancelRetry(userId: string): void {
  const timer = retryTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(userId);
    console.log(`Cancelled retry for ${userId}`);
  }
}
