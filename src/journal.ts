import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { buildSystemPrompt as buildSummarizePrompt, buildUserPrompt, parseNameAliases, correctNames } from "./prompts/summarize.js";
import { pcmToWav } from "./audio.js";

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

function getDateStr(callStartTime: string): string {
  // Use local date components to avoid UTC offset shifting the date
  const d = new Date(callStartTime);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Save raw transcript to data/transcripts/<userId>/YYYY-MM-DD.txt
 * Always appends so multiple calls on the same day are preserved.
 */
export function saveTranscript(callData: CallData): string {
  const transcriptDir = path.join(config.DATA_DIR, "transcripts", callData.userId);
  fs.mkdirSync(transcriptDir, { recursive: true });

  const dateStr = getDateStr(callData.callStartTime);
  const filePath = path.join(transcriptDir, `${dateStr}.txt`);

  const header = `--- Call at ${callData.callStartTime} (${callData.callDurationMinutes} min) ---\n`;
  const content = header + callData.transcript + "\n\n";

  fs.appendFileSync(filePath, content);
  console.log(`Transcript saved: ${filePath}`);
  return filePath;
}

/**
 * Save raw call audio as WAV to data/audio/<userId>/YYYY-MM-DD-<timestamp>.wav
 * Each call gets its own file so multiple calls on the same day are preserved.
 */
export function saveCallAudio(
  userId: string,
  callStartTime: string,
  pcm: Int16Array,
  sampleRate: number
): string | null {
  if (pcm.length === 0) return null;

  const audioDir = path.join(config.DATA_DIR, "audio", userId);
  fs.mkdirSync(audioDir, { recursive: true });

  const dateStr = getDateStr(callStartTime);
  const timestamp = Date.now();
  const filePath = path.join(audioDir, `${dateStr}-${timestamp}.wav`);

  const wav = pcmToWav(pcm, sampleRate);
  fs.writeFileSync(filePath, wav);
  console.log(`Audio saved: ${filePath} (${(wav.length / 1024).toFixed(0)} KB)`);
  return filePath;
}

/**
 * Clean up transcripts and audio older than the retention period.
 */
export function cleanOldTranscripts(): void {
  const cutoff = Date.now() - config.TRANSCRIPT_RETENTION_DAYS * 86_400_000;

  for (const dir of ["transcripts", "audio"]) {
    const root = path.join(config.DATA_DIR, dir);
    if (!fs.existsSync(root)) continue;

    for (const userId of fs.readdirSync(root)) {
      const userDir = path.join(root, userId);
      if (!fs.statSync(userDir).isDirectory()) continue;

      for (const file of fs.readdirSync(userDir)) {
        // Extract date from filename (YYYY-MM-DD.txt or YYYY-MM-DD-timestamp.wav)
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) continue;
        const fileDate = new Date(dateMatch[1]).getTime();
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(userDir, file));
          console.log(`Cleaned old ${dir}: ${userId}/${file}`);
        }
      }
    }
  }
}

function applyNameCorrections(transcript: string): string {
  if (!config.KNOWN_NAMES) return transcript;
  const aliases = parseNameAliases(config.KNOWN_NAMES);
  return correctNames(transcript, aliases);
}

function saveJournalFile(userId: string, dateStr: string, content: string): string {
  const journalDir = path.join(config.DATA_DIR, "journals", userId);
  fs.mkdirSync(journalDir, { recursive: true });

  const filePath = path.join(journalDir, `${dateStr}.md`);

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, "\n\n---\n\n" + content);
    console.log(`Journal appended: ${filePath}`);
  } else {
    fs.writeFileSync(filePath, content);
    console.log(`Journal saved: ${filePath}`);
  }

  return filePath;
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

  const transcript = applyNameCorrections(callData.transcript);

  const userPrompt = buildUserPrompt(
    transcript,
    callData.callStartTime,
    callData.callDurationMinutes
  );

  console.log(`Generating journal for ${callData.userId}...`);
  const systemPrompt = buildSummarizePrompt(config.KNOWN_NAMES);
  const rawJournal = await callLLM(systemPrompt, userPrompt);

  // Post-LLM name correction — catch any names the LLM reintroduced
  const journalContent = applyNameCorrections(rawJournal);

  const dateStr = getDateStr(callData.callStartTime);
  return saveJournalFile(callData.userId, dateStr, journalContent);
}

/**
 * Reprocess a saved transcript file into a new journal entry.
 * Overwrites the existing journal for that date.
 */
export async function reprocessTranscript(userId: string, date: string): Promise<string> {
  const transcriptPath = path.join(config.DATA_DIR, "transcripts", userId, `${date}.txt`);
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`No transcript found: ${transcriptPath}`);
  }

  const raw = fs.readFileSync(transcriptPath, "utf-8");

  // Strip the header lines, combine all call sections into one transcript
  const transcript = raw
    .split("\n")
    .filter((line) => !line.startsWith("--- Call at "))
    .join("\n")
    .trim();

  if (!transcript) {
    throw new Error(`Transcript is empty: ${transcriptPath}`);
  }

  const corrected = applyNameCorrections(transcript);
  const wordCount = corrected.split(/\s+/).filter(Boolean).length;

  const userPrompt = buildUserPrompt(corrected, `${date}T20:00:00`, 0);

  console.log(`Reprocessing transcript for ${userId} on ${date} (${wordCount} words)...`);
  const systemPrompt = buildSummarizePrompt(config.KNOWN_NAMES);
  const rawJournal = await callLLM(systemPrompt, userPrompt);

  // Post-LLM name correction
  const journalContent = applyNameCorrections(rawJournal);

  // Overwrite (not append) when reprocessing
  const journalDir = path.join(config.DATA_DIR, "journals", userId);
  fs.mkdirSync(journalDir, { recursive: true });
  const filePath = path.join(journalDir, `${date}.md`);
  fs.writeFileSync(filePath, journalContent);
  console.log(`Journal reprocessed: ${filePath}`);

  return filePath;
}
