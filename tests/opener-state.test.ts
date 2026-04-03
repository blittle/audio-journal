import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Test the opener state persistence logic independently

interface OpenerState {
  lastOpener: string;
}

function getLastOpener(statePath: string): string | null {
  if (!fs.existsSync(statePath)) return null;
  try {
    const data: OpenerState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return data.lastOpener ?? null;
  } catch {
    return null;
  }
}

function saveLastOpener(statePath: string, opener: string): void {
  fs.writeFileSync(statePath, JSON.stringify({ lastOpener: opener }));
}

describe("opener state persistence", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opener-test-"));
    statePath = path.join(tmpDir, ".opener-state.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no state file exists", () => {
    expect(getLastOpener(statePath)).toBeNull();
  });

  it("saves and reads last opener", () => {
    saveLastOpener(statePath, "Hey, how was your day?");
    expect(getLastOpener(statePath)).toBe("Hey, how was your day?");
  });

  it("overwrites previous state", () => {
    saveLastOpener(statePath, "First opener");
    saveLastOpener(statePath, "Second opener");
    expect(getLastOpener(statePath)).toBe("Second opener");
  });

  it("handles corrupted state file gracefully", () => {
    fs.writeFileSync(statePath, "not valid json{{{");
    expect(getLastOpener(statePath)).toBeNull();
  });

  it("handles state file with missing lastOpener field", () => {
    fs.writeFileSync(statePath, JSON.stringify({ otherField: "value" }));
    expect(getLastOpener(statePath)).toBeNull();
  });
});
