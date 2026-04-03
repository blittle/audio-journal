import { z } from "zod";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that a userId is safe for use in file paths and logs.
 * Throws if the userId contains path traversal or special characters.
 */
export function sanitizeUserId(userId: string): string {
  if (!userId || !SAFE_ID_RE.test(userId)) {
    throw new Error(`Invalid userId: must be alphanumeric, dash, or underscore`);
  }
  return userId;
}

const userSchema = z.object({
  id: z.string().min(1).regex(SAFE_ID_RE, "Must be alphanumeric, dash, or underscore"),
  phoneNumber: z.string().min(1),
  callTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  timezone: z.string(),
  conversationStyle: z.enum(["casual", "reflective", "structured"]).default("casual"),
  enabled: z.boolean().default(true),
});

export type User = z.infer<typeof userSchema>;

const usersFilePath = path.join(config.DATA_DIR, "users.json");

function ensureDefaultUser(): User[] {
  if (!config.PHONE_NUMBER) {
    console.error(
      "No users.json found and PHONE_NUMBER not set. Configure at least one user."
    );
    process.exit(1);
  }

  const defaultUser: User = {
    id: "default",
    phoneNumber: config.PHONE_NUMBER,
    callTime: config.CALL_TIME,
    timezone: config.TIMEZONE,
    conversationStyle: config.CONVERSATION_STYLE,
    enabled: true,
  };

  fs.mkdirSync(path.dirname(usersFilePath), { recursive: true });
  fs.writeFileSync(usersFilePath, JSON.stringify([defaultUser], null, 2));
  console.log(`Created default user in ${usersFilePath}`);
  return [defaultUser];
}

function loadUsers(): User[] {
  if (!fs.existsSync(usersFilePath)) {
    return ensureDefaultUser();
  }

  const raw = JSON.parse(fs.readFileSync(usersFilePath, "utf-8"));
  const result = z.array(userSchema).safeParse(raw);
  if (!result.success) {
    console.error("Invalid users.json:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

let users = loadUsers();

export function getAllUsers(): User[] {
  return users.filter((u) => u.enabled);
}

export function getUser(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function getUserByPhone(phone: string): User | undefined {
  return users.find((u) => u.phoneNumber === phone);
}

export function reloadUsers(): void {
  users = loadUsers();
  console.log(`Reloaded ${users.length} user(s) from ${usersFilePath}`);
}
