import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import twilio from "twilio";
import { config } from "./config.js";
import { getUser, sanitizeUserId } from "./users.js";
import { buildSystemPrompt, pickOpener } from "./prompts/conversation.js";
import { ConversationSession, setSession, removeSession } from "./session.js";
import { mulawDecode, mulawEncode, calculateRMS, pcmToWav, decodeMp3 } from "./audio.js";
import { transcribe } from "./stt.js";
import { synthesize } from "./tts.js";
import { generateJournal } from "./journal.js";
import { parseCallbackTime, scheduleRetry } from "./reschedule.js";

const MULAW_SAMPLE_RATE = 8000;
const CHUNK_DURATION_MS = 20;
const SAMPLES_PER_CHUNK = (MULAW_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000; // 160
const RMS_SPEECH_THRESHOLD = 200;

// Time to wait for user to speak after opener before hanging up (ms)
const NO_RESPONSE_TIMEOUT_MS = 30_000;

// Idle = no speech detected, no audio buffered, not processing a turn
// After IDLE_PROMPT_MS, ask "Are you still there?"
// After IDLE_HANGUP_MS total, close the call
const IDLE_PROMPT_MS = 20_000;
const IDLE_HANGUP_MS = 25_000;

// Phrases that mean "don't call today at all"
const SKIP_PHRASES = ["skip today", "not today", "skip tonight"];

// Phrases that mean "call me back later" — triggers reschedule
const CALLBACK_PHRASES = [
  "call me back",
  "not a good time",
  "call back later",
  "call me later",
  "not right now",
  "try again later",
  "call back",
  "bad time",
];

// Phrases that mean the user wants to wrap up the current conversation
const WRAP_UP_PHRASES = [
  "i'm done",
  "im done",
  "that's it",
  "thats it",
  "that's all",
  "thats all",
  "i'm finished",
  "im finished",
  "i'm good",
  "im good",
  "nothing else",
  "that's everything",
  "we can stop",
  "let's wrap up",
  "wrap it up",
  "good night",
  "goodbye",
  "bye",
];

interface TwilioStartMessage {
  event: "start";
  start: {
    streamSid: string;
    callSid: string;
    customParameters: Record<string, string>;
  };
  streamSid: string;
}

interface TwilioMediaMessage {
  event: "media";
  media: {
    payload: string;
  };
  streamSid: string;
}

interface TwilioMessage {
  event: string;
  [key: string]: unknown;
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const baseUrl = (config.LLM_BASE_URL ?? config.LEMONADE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.LLM_API_KEY) {
    headers["Authorization"] = `Bearer ${config.LLM_API_KEY}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.LLM_MODEL,
      messages,
      max_tokens: 150,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

function sendAudio(ws: WebSocket, streamSid: string, mulawBuffer: Buffer): void {
  const bytesPerChunk = SAMPLES_PER_CHUNK; // 160 bytes = 20ms at 8kHz mulaw
  for (let i = 0; i < mulawBuffer.length; i += bytesPerChunk) {
    const chunk = mulawBuffer.subarray(i, i + bytesPerChunk);
    ws.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: chunk.toString("base64") },
      })
    );
  }
}

function sendMark(ws: WebSocket, streamSid: string, markName: string): void {
  ws.send(
    JSON.stringify({
      event: "mark",
      streamSid,
      mark: { name: markName },
    })
  );
}

function sendClear(ws: WebSocket, streamSid: string): void {
  ws.send(JSON.stringify({ event: "clear", streamSid }));
}

async function synthesizeAndSend(
  ws: WebSocket,
  session: ConversationSession,
  text: string
): Promise<void> {
  const mp3 = await synthesize(text);
  const pcm = await decodeMp3(mp3);
  const mulaw = mulawEncode(pcm);
  session.startPlaying();
  sendAudio(ws, session.streamSid, mulaw);
  sendMark(ws, session.streamSid, session.nextMarkName());
}

function matchesPhrase(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p));
}

function isClosingLine(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("have a good night") ||
    lower.includes("sleep well") ||
    lower.includes("talk to you tomorrow") ||
    lower.includes("enjoy your evening") ||
    lower.includes("good night") ||
    lower.includes("take care")
  );
}

async function handleCallback(
  ws: WebSocket,
  session: ConversationSession,
  userText: string
): Promise<void> {
  const user = getUser(session.userId);
  const timezone = user?.timezone ?? "America/Denver";

  const { minutes, displayTime } = await parseCallbackTime(userText, timezone);

  const reply = `No problem. I'll call you back ${displayTime}.`;
  console.log(`[${session.userId}] Scheduling callback: ${minutes} min (${displayTime})`);

  session.addAssistantMessage(reply);
  await synthesizeAndSend(ws, session, reply);

  scheduleRetry(session.userId, minutes);

  setTimeout(() => ws.close(), 3000);
}

async function handleIdlePrompt(
  ws: WebSocket,
  session: ConversationSession
): Promise<void> {
  if (session.promptedStillThere || session.isProcessing) return;

  console.log(`[${session.userId}] No speech for ${IDLE_PROMPT_MS / 1000}s, prompting`);
  session.markPromptedStillThere();

  try {
    await synthesizeAndSend(ws, session, "Are you still there?");
  } catch (err) {
    console.error(`[${session.userId}] Failed to send idle prompt:`, err);
  }
}

async function processTurn(ws: WebSocket, session: ConversationSession): Promise<void> {
  if (!session.startProcessing()) return;

  try {
    // 1. Collect buffered audio → WAV
    const pcm = session.getBufferedAudio();
    session.clearAudioBuffer();

    if (pcm.length < MULAW_SAMPLE_RATE * 0.3) {
      return;
    }

    const wav = pcmToWav(pcm, MULAW_SAMPLE_RATE);

    // 2. STT
    const userText = await transcribe(wav);
    if (!userText || userText.length < 2) return;

    session.markUserSpoke();
    session.resetIdle();

    console.log(`[${session.userId}] User: ${userText}`);
    session.addUserMessage(userText);

    // 3. Check for "skip today"
    if (matchesPhrase(userText, SKIP_PHRASES)) {
      const reply = "Got it, no worries. I'll call again tomorrow.";
      console.log(`[${session.userId}] CALL_END reason=skip_phrase user_said="${userText}"`);
      session.markSkipJournal();
      session.addAssistantMessage(reply);
      await synthesizeAndSend(ws, session, reply);
      setTimeout(() => ws.close(), 3000);
      return;
    }

    // 4. Check for callback phrases
    if (matchesPhrase(userText, CALLBACK_PHRASES)) {
      console.log(`[${session.userId}] CALL_END reason=callback_phrase user_said="${userText}"`);
      session.markSkipJournal();
      await handleCallback(ws, session, userText);
      return;
    }

    // 5. Check if user wants to wrap up
    const userWantsToEnd = matchesPhrase(userText, WRAP_UP_PHRASES);

    // 6. LLM
    const assistantText = await chatCompletion(session.getMessages());
    console.log(`[${session.userId}] Assistant: ${assistantText}`);
    session.addAssistantMessage(assistantText);

    // 7. TTS → send audio
    await synthesizeAndSend(ws, session, assistantText);

    // 8. Close if closing line or user asked to wrap up
    if (isClosingLine(assistantText) || userWantsToEnd) {
      const reason = userWantsToEnd ? "wrap_up_phrase" : "closing_line";
      const trigger = userWantsToEnd ? userText : assistantText;
      console.log(`[${session.userId}] CALL_END reason=${reason} triggered_by="${trigger}"`);
      setTimeout(() => ws.close(), 5000);
    }
  } catch (err) {
    console.error(`[${session.userId}] Turn processing error:`, err);
  } finally {
    session.finishProcessing();
  }
}

async function endCall(session: ConversationSession): Promise<void> {
  const transcript = session.getTranscript();
  if (!transcript || session.shouldSkipJournal) {
    if (session.shouldSkipJournal) {
      console.log(`[${session.userId}] Skipping journal (control phrase)`);
    }
    return;
  }

  try {
    await generateJournal({
      userId: session.userId,
      transcript,
      callStartTime: session.startedAt.toISOString(),
      callDurationMinutes: session.getDurationMinutes(),
    });
  } catch (err) {
    console.error(`[${session.userId}] Journal generation failed:`, err);
  }
}

function handleConnection(ws: WebSocket): void {
  let session: ConversationSession | null = null;
  let noResponseTimer: ReturnType<typeof setTimeout> | null = null;

  function clearNoResponseTimer(): void {
    if (noResponseTimer) {
      clearTimeout(noResponseTimer);
      noResponseTimer = null;
    }
  }

  ws.on("message", async (data) => {
    const msg = JSON.parse(data.toString()) as TwilioMessage;

    switch (msg.event) {
      case "connected":
        console.log("Twilio WebSocket connected");
        break;

      case "start": {
        const startMsg = msg as unknown as TwilioStartMessage;
        const callSid = startMsg.start.callSid;
        const streamSid = startMsg.start.streamSid ?? startMsg.streamSid;

        // Verify this callSid exists in our Twilio account
        try {
          const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
          await twilioClient.calls(callSid).fetch();
        } catch {
          console.error(`CALL_END reason=invalid_call_sid callSid="${String(callSid).slice(0, 40)}"`);
          ws.close();
          return;
        }

        let userId: string;
        try {
          userId = sanitizeUserId(startMsg.start.customParameters.userId);
        } catch {
          console.error(`CALL_END reason=invalid_user_id raw="${String(startMsg.start.customParameters.userId).slice(0, 50)}"`);
          ws.close();
          return;
        }

        const user = getUser(userId);
        if (!user) {
          console.error(`[${userId}] CALL_END reason=unknown_user`);
          ws.close();
          return;
        }

        const opener = pickOpener(user.conversationStyle, null);
        const systemPrompt = buildSystemPrompt(user, opener);

        session = new ConversationSession(callSid, userId, systemPrompt);
        session.streamSid = streamSid;
        setSession(callSid, session);

        console.log(`[${userId}] Call started: ${callSid}`);

        session.addAssistantMessage(opener);
        try {
          await synthesizeAndSend(ws, session, opener);
        } catch (err) {
          console.error(`[${userId}] Failed to send opener:`, err);
        }

        // No-response timer — if user never speaks at all after opener
        noResponseTimer = setTimeout(() => {
          if (session && !session.hasUserSpoken()) {
            console.log(`[${userId}] CALL_END reason=no_response timeout=${NO_RESPONSE_TIMEOUT_MS / 1000}s`);
            ws.close();
          }
        }, NO_RESPONSE_TIMEOUT_MS);

        break;
      }

      case "media": {
        if (!session) break;
        const mediaMsg = msg as unknown as TwilioMediaMessage;
        const pcm = mulawDecode(mediaMsg.media.payload);
        const rms = calculateRMS(pcm);

        if (rms > RMS_SPEECH_THRESHOLD) {
          // Speech detected
          if (!session.hasUserSpoken()) {
            clearNoResponseTimer();
          }

          // Barge-in: user is speaking while assistant audio is playing
          if (session.isPlaying) {
            console.log(`[${session.userId}] Barge-in detected, clearing playback`);
            sendClear(ws, session.streamSid);
            session.stopPlaying();
          }

          session.appendAudio(pcm);
          session.resetSilence();
          session.resetIdle();
        } else {
          // Silence — only count it when we're not playing audio back
          // (Twilio sends inbound silence while outbound audio plays)
          if (!session.isPlaying) {
            session.incrementSilence(CHUNK_DURATION_MS);

            // Turn detection: silence after buffered speech → process turn
            if (
              session.isSilenceThresholdReached() &&
              session.hasBufferedAudio() &&
              !session.isProcessing
            ) {
              session.resetSilence();
              processTurn(ws, session);
            }

            // Idle detection: no buffered audio and not processing → user is quiet
            if (
              !session.hasBufferedAudio() &&
              !session.isProcessing &&
              session.hasUserSpoken()
            ) {
              session.incrementIdle(CHUNK_DURATION_MS);

              if (session.getIdleMs() >= IDLE_PROMPT_MS && !session.promptedStillThere) {
                handleIdlePrompt(ws, session);
              }

              if (session.getIdleMs() >= IDLE_HANGUP_MS) {
                console.log(`[${session.userId}] CALL_END reason=idle_timeout idle=${session.getIdleMs()}ms`);
                ws.close();
              }
            }
          }
        }
        break;
      }

      case "mark":
        // Playback complete
        if (session) {
          session.stopPlaying();
        }
        break;

      case "stop": {
        console.log(`[${session?.userId ?? "unknown"}] CALL_END reason=twilio_stop`);
        clearNoResponseTimer();
        if (session) {
          const s = removeSession(session.callSid);
          if (s) endCall(s);
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log(`[${session?.userId ?? "unknown"}] WebSocket closed`);
    clearNoResponseTimer();
    if (session) {
      const s = removeSession(session.callSid);
      if (s) endCall(s);
      session = null;
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
}

export function attachMediaStreamHandler(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  wss.on("connection", handleConnection);
  console.log("WebSocket media-stream handler attached");
}
