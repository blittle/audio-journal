import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { buildSystemPrompt as buildSummarizePrompt, buildUserPrompt, parseNameAliases, correctNames } from "./prompts/summarize.js";

interface CallData {
  userId: string;
  transcript: string;
  callStartTime: string;
  callDurationMinutes: number;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const baseUrl = config.SUMMARIZE_LLM_BASE_URL ?? config.LLM_BASE_URL;
  const apiKey = config.SUMMARIZE_LLM_API_KEY ?? config.LLM_API_KEY;
  const model = config.SUMMARIZE_MODEL ?? config.LLM_MODEL ?? "gpt-4o-mini";

  if (!baseUrl) {
    throw new Error(
      "No LLM endpoint configured. Set LLM_BASE_URL or SUMMARIZE_LLM_BASE_URL."
    );
  }

  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateJournal(callData: CallData): Promise<string> {
  const wordCount = callData.transcript.split(/\s+/).filter(Boolean).length;

  // Skip journal if transcript is too short and looks like a control phrase
  if (wordCount < 10) {
    const lower = callData.transcript.toLowerCase();
    if (lower.includes("skip") || lower.includes("call me back")) {
      console.log(
        `Skipping journal for ${callData.userId}: control phrase detected`
      );
      return "";
    }
  }

  // Fix misspelled names in transcript before sending to LLM
  let transcript = callData.transcript;
  if (config.KNOWN_NAMES) {
    const aliases = parseNameAliases(config.KNOWN_NAMES);
    transcript = correctNames(transcript, aliases);
  }

  const userPrompt = buildUserPrompt(
    transcript,
    callData.callStartTime,
    callData.callDurationMinutes
  );

  console.log(`Generating journal for ${callData.userId}...`);
  const systemPrompt = buildSummarizePrompt(config.KNOWN_NAMES);
  const journalContent = await callLLM(systemPrompt, userPrompt);

  // Save to file
  const journalDir = path.join(config.DATA_DIR, "journals", callData.userId);
  fs.mkdirSync(journalDir, { recursive: true });

  const date = new Date(callData.callStartTime);
  const dateStr = date.toISOString().split("T")[0];
  const filePath = path.join(journalDir, `${dateStr}.md`);

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, "\n\n---\n\n" + journalContent);
    console.log(`Journal appended: ${filePath}`);
  } else {
    fs.writeFileSync(filePath, journalContent);
    console.log(`Journal saved: ${filePath}`);
  }

  return filePath;
}
