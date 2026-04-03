# Audio Journal

A voice-powered daily journal agent. It calls you every evening, asks how your day was, and writes a journal entry from the conversation.

Supports multiple users, configurable call times, and any OpenAI-compatible LLM (cloud or self-hosted).

## Quick Start

1. **Get a Vapi account** at [vapi.ai](https://vapi.ai) and create a phone number
2. **Clone and configure:**
   ```bash
   git clone <repo-url> && cd audio-journal
   cp .env.example .env
   # Edit .env with your Vapi API key, phone number ID, and webhook URL
   ```
3. **Run:**
   ```bash
   npm install
   npm run dev
   ```
4. **Test:** Send a POST to `http://localhost:3000/trigger` to receive a test call

## Configuration

### Single User (Quick Start)

Set these in `.env`:

| Variable | Description | Default |
|---|---|---|
| `VAPI_API_KEY` | Vapi API key (required) | |
| `VAPI_PHONE_NUMBER_ID` | Vapi outbound phone number ID (required) | |
| `WEBHOOK_URL` | Public URL for Vapi webhooks (required) | |
| `PHONE_NUMBER` | Your phone number | |
| `CALL_TIME` | When to call (HH:MM) | `20:00` |
| `TIMEZONE` | Your timezone | `America/Denver` |
| `CONVERSATION_STYLE` | `casual`, `reflective`, or `structured` | `casual` |

### Multiple Users

Create `data/users.json`:

```json
[
  {
    "id": "alice",
    "phoneNumber": "+15551234567",
    "callTime": "20:00",
    "timezone": "America/Denver",
    "conversationStyle": "casual",
    "enabled": true
  },
  {
    "id": "bob",
    "phoneNumber": "+15559876543",
    "callTime": "21:30",
    "timezone": "America/New_York",
    "conversationStyle": "reflective",
    "enabled": true
  }
]
```

### Using a Local LLM

Point `LLM_BASE_URL` at any OpenAI-compatible endpoint:

```bash
# LM Studio
LLM_BASE_URL=http://localhost:1234/v1

# Lemonade
LLM_BASE_URL=http://localhost:5000/v1

# Ollama
LLM_BASE_URL=http://localhost:11434/v1
```

You can also use a separate (cheaper) model for journal summarization:

```bash
SUMMARIZE_LLM_BASE_URL=http://localhost:1234/v1
SUMMARIZE_MODEL=llama-3-8b
```

## Docker

```bash
cp .env.example .env
# Edit .env
docker compose up -d
```

## Exposing Webhooks

Vapi needs to reach your server to deliver call transcripts. Options:

- **Local dev:** Use [ngrok](https://ngrok.com) — `ngrok http 3000` — and set `WEBHOOK_URL` to the ngrok URL
- **Production:** Deploy to any VPS/cloud provider and point `WEBHOOK_URL` to your public URL

## How It Works

1. At the scheduled time, the server calls your phone via Vapi
2. An AI assistant asks about your day using natural follow-up questions
3. When the call ends, Vapi sends the transcript to the webhook
4. The transcript is sent to an LLM which writes a first-person journal entry
5. The journal is saved as a markdown file in `data/journals/<user-id>/YYYY-MM-DD.md`

## Journal Format

Each journal entry includes:
- **Mood** detected from the conversation
- **Summary** — 2-3 sentence overview
- **What Happened** — chronological narrative
- **How I'm Feeling** — emotional reflection (if applicable)
- **On My Mind** — forward-looking thoughts (if applicable)

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/trigger` | Trigger a call for the default user |
| `POST` | `/trigger/:userId` | Trigger a call for a specific user |
| `POST` | `/webhook/vapi` | Vapi webhook (automatic) |
