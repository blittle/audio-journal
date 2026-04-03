import express, { type Request, type Response, type NextFunction } from "express";
import twilio from "twilio";
import { config } from "./config.js";
import { triggerCall } from "./twilio.js";
import { getAllUsers, getUserByPhone, sanitizeUserId } from "./users.js";

const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

export const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Auth middleware ---

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.API_KEY) {
    // No API key configured — allow (dev mode)
    next();
    return;
  }
  const token =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ??
    (req.query.key as string | undefined);
  if (token !== config.API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function validateTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    console.warn("Missing X-Twilio-Signature on webhook request");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const url = config.WEBHOOK_URL.replace(/\/$/, "") + req.originalUrl;
  const valid = twilio.validateRequest(
    config.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );

  if (!valid) {
    console.warn("Invalid Twilio signature on webhook request");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// --- Routes ---

// Health check (no auth — informational only)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", users: getAllUsers().length });
});

// Twilio async AMD callback
app.post("/call-status", validateTwilioSignature, async (req, res) => {
  const { CallSid, AnsweredBy } = req.body;

  if (AnsweredBy && AnsweredBy !== "human") {
    console.log(`Answering machine detected on ${CallSid} (${AnsweredBy}), hanging up`);
    try {
      await twilioClient.calls(CallSid).update({ status: "completed" });
    } catch (err) {
      console.error(`Failed to hang up call ${CallSid}:`, err);
    }
  }

  res.sendStatus(200);
});

// Trigger a call for the first/default user
app.post("/trigger", requireApiKey, async (_req, res) => {
  const users = getAllUsers();
  if (users.length === 0) {
    res.status(400).json({ error: "No users configured" });
    return;
  }
  try {
    const callId = await triggerCall(users[0].id);
    res.json({ callId, userId: users[0].id });
  } catch (err) {
    console.error("Failed to trigger call:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Incoming call from Twilio — user calls the Twilio number to start a journal
app.post("/incoming-call", validateTwilioSignature, (req, res) => {
  const from = req.body.From as string | undefined;

  if (!from) {
    console.warn("Incoming call with no From number");
    res.type("text/xml").send("<Response><Say>Sorry, I can't identify you.</Say><Hangup/></Response>");
    return;
  }

  const user = getUserByPhone(from);
  if (!user) {
    console.log(`Incoming call from unknown number: ${from}`);
    res.type("text/xml").send("<Response><Say>Sorry, this number is not registered.</Say><Hangup/></Response>");
    return;
  }

  console.log(`Incoming call from ${user.id} (${from})`);

  const wsUrl = config.WEBHOOK_URL
    .replace(/^http/, "ws")
    .replace(/\/$/, "") + "/media-stream";

  res.type("text/xml").send(
    `<Response><Connect><Stream url="${wsUrl}"><Parameter name="userId" value="${user.id}" /></Stream></Connect></Response>`
  );
});

// Trigger a call for a specific user
app.post("/trigger/:userId", requireApiKey, async (req, res) => {
  const userId = String(req.params.userId);
  try {
    sanitizeUserId(userId);
  } catch {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  try {
    const callId = await triggerCall(userId);
    res.json({ callId, userId });
  } catch (err) {
    console.error(`Failed to trigger call for ${userId}:`, err);
    res.status(500).json({ error: String(err) });
  }
});
