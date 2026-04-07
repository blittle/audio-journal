#!/usr/bin/env node
import { reprocessTranscript } from "./journal.js";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

const args = process.argv.slice(2);

function usage(): void {
  console.log(`Usage:
  npm run reprocess <date>              Reprocess transcript for default user
  npm run reprocess <userId> <date>     Reprocess transcript for a specific user
  npm run reprocess --list [userId]     List available transcripts

  date format: YYYY-MM-DD

Examples:
  npm run reprocess 2026-04-06
  npm run reprocess default 2026-04-06
  npm run reprocess --list`);
  process.exit(1);
}

function listTranscripts(userId?: string): void {
  const transcriptsRoot = path.join(config.DATA_DIR, "transcripts");
  if (!fs.existsSync(transcriptsRoot)) {
    console.log("No transcripts found.");
    return;
  }

  const users = userId ? [userId] : fs.readdirSync(transcriptsRoot);
  for (const uid of users) {
    const userDir = path.join(transcriptsRoot, uid);
    if (!fs.existsSync(userDir) || !fs.statSync(userDir).isDirectory()) continue;

    const files = fs.readdirSync(userDir).filter((f) => f.endsWith(".txt")).sort();
    if (files.length === 0) continue;

    console.log(`\n${uid}:`);
    for (const file of files) {
      const filePath = path.join(userDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const size = fs.statSync(filePath).size;
      console.log(`  ${file.replace(".txt", "")}  (${wordCount} words, ${size} bytes)`);
    }
  }
}

async function main(): Promise<void> {
  if (args.length === 0) usage();

  if (args[0] === "--list") {
    listTranscripts(args[1]);
    return;
  }

  let userId: string;
  let date: string;

  if (args.length === 1) {
    userId = "default";
    date = args[0];
  } else {
    userId = args[0];
    date = args[1];
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Invalid date format: ${date} (expected YYYY-MM-DD)`);
    process.exit(1);
  }

  try {
    const filePath = await reprocessTranscript(userId, date);
    console.log(`\nDone! Journal written to: ${filePath}`);
    console.log("\n" + fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`Failed: ${err}`);
    process.exit(1);
  }
}

main();
