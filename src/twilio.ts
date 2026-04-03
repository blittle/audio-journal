import twilio from "twilio";
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getUser, type User } from "./users.js";
import { pickOpener } from "./prompts/conversation.js";

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

function getOpenerStatePath(user: User): string {
  const dir = path.join(config.DATA_DIR, "journals", user.id);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, ".opener-state.json");
}

function getLastOpener(user: User): string | null {
  const statePath = getOpenerStatePath(user);
  if (!fs.existsSync(statePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return data.lastOpener ?? null;
  } catch {
    return null;
  }
}

function saveLastOpener(user: User, opener: string): void {
  const statePath = getOpenerStatePath(user);
  fs.writeFileSync(statePath, JSON.stringify({ lastOpener: opener }));
}

export async function triggerCall(userId: string): Promise<string> {
  const user = getUser(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const lastOpener = getLastOpener(user);
  const opener = pickOpener(user.conversationStyle, lastOpener);
  saveLastOpener(user, opener);

  // Build WebSocket URL from WEBHOOK_URL (convert http(s) to ws(s))
  const wsUrl = config.WEBHOOK_URL
    .replace(/^http/, "ws")
    .replace(/\/$/, "") + "/media-stream";

  const twiml = `<Response><Connect><Stream url="${wsUrl}"><Parameter name="userId" value="${user.id}" /></Stream></Connect></Response>`;

  const call = await client.calls.create({
    twiml,
    to: user.phoneNumber,
    from: config.TWILIO_PHONE_NUMBER,
  });

  console.log(`Call initiated for user ${user.id}: ${call.sid}`);
  return call.sid;
}
