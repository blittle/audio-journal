# Audio Journal

A voice-powered daily journal agent that runs entirely on your local machine. It calls you every evening, listens while you talk about your day, and writes a journal entry from the conversation.

All AI processing is local via [Lemonade](https://github.com/onnx/turnkeyml/tree/main/lemonade): Whisper for speech-to-text, Kokoro for text-to-speech, and Qwen3.5 for conversation and journal summarization. Twilio handles only the phone bridge. No audio or transcripts leave your network.

## Prerequisites

- **Node.js** 22+
- **[Lemonade](https://github.com/onnx/turnkeyml/tree/main/lemonade)** running locally with these models loaded:
  - `Whisper-Large-v3-Turbo` (STT)
  - `kokoro-v1` (TTS)
  - `Qwen3.5-4B-GGUF` (LLM)
- **Twilio** account with a phone number
- **ffmpeg** installed (`sudo pacman -S ffmpeg` / `apt install ffmpeg`)
- **Public URL** for Twilio webhooks (Cloudflare Tunnel, ngrok, or a VPS)

## Quick Start

1. **Clone and install:**
   ```bash
   git clone <repo-url> && cd audio-journal
   npm install
   ```

2. **Set up Lemonade** (if not already running):
   ```bash
   lemonade-server pull Whisper-Large-v3-Turbo
   lemonade-server pull kokoro-v1
   lemonade-server pull Qwen3.5-4B-GGUF
   lemonade-server serve
   lemonade load Qwen3.5-4B-GGUF
   lemonade load Whisper-Large-v3-Turbo
   lemonade load kokoro-v1
   ```

3. **Start a tunnel** (for Twilio to reach your machine):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   # Note the https://xxxxx.trycloudflare.com URL
   ```

4. **Configure:**
   ```bash
   cp .env.example .env
   # Edit .env with your Twilio credentials, tunnel URL, and phone number
   ```

5. **Run:**
   ```bash
   npm run dev
   ```

6. **Test:** Trigger a call manually:
   ```bash
   # Without API key:
   curl -X POST http://localhost:3000/trigger

   # With API key configured:
   curl -X POST -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/trigger
   ```

## Configuration

### Required

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number (e.g. `+18335551234`) |
| `WEBHOOK_URL` | Public URL where Twilio can reach your server |

### User Settings

Set these in `.env` for single-user quick start (auto-creates `data/users.json`):

| Variable | Description | Default |
|---|---|---|
| `PHONE_NUMBER` | Your phone number to receive calls | |
| `CALL_TIME` | When to call (HH:MM, 24h) | `20:00` |
| `TIMEZONE` | Your timezone | `America/Denver` |
| `CONVERSATION_STYLE` | `casual`, `reflective`, or `structured` | `casual` |

### AI Models

| Variable | Description | Default |
|---|---|---|
| `LEMONADE_URL` | Lemonade API endpoint | `http://127.0.0.1:8000/api/v1` |
| `LLM_MODEL` | Chat model for conversation | `Qwen3.5-4B-GGUF` |
| `STT_MODEL` | Speech-to-text model | `Whisper-Large-v3-Turbo` |
| `TTS_MODEL` | Text-to-speech model | `kokoro-v1` |
| `TTS_VOICE` | TTS voice | `af_heart` |
| `LLM_BASE_URL` | Override LLM endpoint (if not using Lemonade) | |
| `SUMMARIZE_MODEL` | Separate model for journal summarization | |

### Name Correction

Speech-to-text frequently misspells names. Use `KNOWN_NAMES` to define the correct spellings and common STT mistakes:

```bash
KNOWN_NAMES=Tearsa (wife, STT often hears: Kersa, Carissa, Teresa), Taiah (daughter, STT often hears: Taya, Kea)
```

Names are corrected in two ways:
- **Deterministic replacement** on the transcript before the LLM sees it (using the "STT often hears" aliases)
- **Whisper hint** via the `prompt` parameter so STT is more likely to get them right

### Other Settings

| Variable | Description | Default |
|---|---|---|
| `SILENCE_THRESHOLD_MS` | Silence duration before processing a turn (ms) | `3000` |
| `API_KEY` | API key for `/trigger` endpoints (optional) | |
| `PORT` | Server port | `3000` |
| `DATA_DIR` | Data directory for journals and user config | `./data` |

## Multiple Users

Create `data/users.json` directly:

```json
[
  {
    "id": "alice",
    "phoneNumber": "+15551234567",
    "callTime": "20:00",
    "timezone": "America/New_York",
    "conversationStyle": "casual",
    "enabled": true
  },
  {
    "id": "bob",
    "phoneNumber": "+15559876543",
    "callTime": "21:30",
    "timezone": "America/Chicago",
    "conversationStyle": "reflective",
    "enabled": true
  }
]
```

## Inbound Calls

You can call your Twilio number to start a journal entry anytime. The system matches your caller ID against configured users. Unknown numbers are rejected.

To configure, set the Twilio phone number's voice webhook to `https://your-domain.com/incoming-call` (POST). This can be done in the Twilio console or via CLI:

```bash
# Find your phone number SID
curl -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json"

# Set the webhook
curl -X POST -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers/PNxxxxxxx.json" \
  -d "VoiceUrl=https://your-domain.com/incoming-call" \
  -d "VoiceMethod=POST"
```

## How It Works

```
Scheduler (cron) or POST /trigger
  → Twilio outbound call with TwiML <Stream>
  → Twilio opens WebSocket to /media-stream

Phone ↔ Twilio ↔ WebSocket (mulaw 8kHz) ↔ media-stream handler
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ↓                          ↓                          ↓
              Whisper STT              Qwen3.5 LLM chat           Kokoro TTS
              (Lemonade)               (Lemonade)                 (Lemonade)
                                               ↓
                              On call end → Journal generation (LLM summarization)
                              → Saved to data/journals/<user-id>/YYYY-MM-DD.md
```

1. At the scheduled time, the server calls your phone via Twilio
2. A voice companion asks about your day using natural follow-up questions
3. Speech is transcribed locally via Whisper, responses generated by Qwen3.5, spoken back via Kokoro
4. When the call ends, the full transcript is summarized into a first-person journal entry
5. The journal is saved as markdown in `data/journals/<user-id>/YYYY-MM-DD.md`
6. Multiple calls on the same day are appended to the same file

## Voice Commands

During a call, you can say:

| Phrase | What happens |
|---|---|
| "I'm done" / "that's it" / "goodbye" | Ends the conversation, journal is saved |
| "Skip today" / "not today" | Ends the call, no journal entry |
| "Call me back" / "not a good time" | Ends the call, schedules a retry |
| "Call me back in 30 minutes" | Parses the time and calls back then |
| "Call me back at 9" | Parses the time and calls back at 9 PM |

## Journal Format

```markdown
# Journal -- April 3, 2026

**Mood:** reflective
**Duration:** 5 minutes

## Summary

Had a long day at work with a deadline, then unwound with a movie.

## What I Said

Work was stressful today. We had a big deadline and I barely made it. Tearsa picked up
the kids from school while I stayed late. When I got home we watched a comedy together
and it was exactly what I needed.

---

*Transcript word count: 89 | Processed: 2026-04-03T20:05:30Z*
```

The "What I Said" section preserves your own words, cleaned up for grammar and filler words.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Health check |
| `POST` | `/trigger` | API key | Trigger a call for the default user |
| `POST` | `/trigger/:userId` | API key | Trigger a call for a specific user |
| `POST` | `/incoming-call` | Twilio signature | Webhook for inbound calls |
| `POST` | `/call-status` | Twilio signature | AMD callback (answering machine detection) |
| `WS` | `/media-stream` | CallSid validation | Twilio media stream WebSocket |

## Docker

```bash
cp .env.example .env
# Edit .env
docker compose up -d
```

The Dockerfile includes ffmpeg. You still need Lemonade running on the host (or accessible via network).

## Testing

```bash
# Unit tests (no external dependencies)
npm test

# E2E tests (requires Lemonade running)
npx vitest run tests/e2e.test.ts

# Name correction tests (requires Lemonade running)
npx vitest run tests/name-correction.test.ts

# LLM integration tests (requires Lemonade running)
npx vitest run tests/integration.test.ts
```

## Security

- `/trigger` endpoints require an API key (set `API_KEY` in `.env`)
- `/incoming-call` and `/call-status` validate Twilio request signatures
- WebSocket connections verify the callSid exists in your Twilio account
- User IDs are restricted to alphanumeric, dash, and underscore characters
- All AI processing is local — no audio, transcripts, or journal content leaves your network
