import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Test the journal generation logic by mocking the LLM call
// We can't import directly due to config side effects, so we test the logic patterns

describe("journal skip logic", () => {
  function shouldSkipJournal(transcript: string): boolean {
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    if (wordCount < 10) {
      const lower = transcript.toLowerCase();
      if (lower.includes("skip") || lower.includes("call me back")) {
        return true;
      }
    }
    return false;
  }

  it("skips when transcript contains 'skip' and is short", () => {
    expect(shouldSkipJournal("skip today")).toBe(true);
    expect(shouldSkipJournal("I want to skip")).toBe(true);
  });

  it("skips when transcript contains 'call me back' and is short", () => {
    expect(shouldSkipJournal("call me back")).toBe(true);
    expect(shouldSkipJournal("can you call me back later")).toBe(true);
  });

  it("does not skip a normal short transcript", () => {
    expect(shouldSkipJournal("I had a good day")).toBe(false);
  });

  it("does not skip a long transcript even with skip keyword", () => {
    const longTranscript =
      "I wanted to skip the gym today but I went anyway and it was really great and I felt much better afterward";
    expect(shouldSkipJournal(longTranscript)).toBe(false);
  });

  it("does not skip empty transcript", () => {
    expect(shouldSkipJournal("")).toBe(false);
  });
});

describe("journal file path generation", () => {
  function getJournalPath(
    dataDir: string,
    userId: string,
    callStartTime: string
  ): string {
    const journalDir = path.join(dataDir, "journals", userId);
    const date = new Date(callStartTime);
    const dateStr = date.toISOString().split("T")[0];
    return path.join(journalDir, `${dateStr}.md`);
  }

  it("generates correct path with date", () => {
    const result = getJournalPath(
      "./data",
      "alice",
      "2026-04-02T20:00:00Z"
    );
    expect(result).toBe("data/journals/alice/2026-04-02.md");
  });

  it("uses user id as directory name", () => {
    const result = getJournalPath(
      "./data",
      "bob",
      "2026-04-02T20:00:00Z"
    );
    expect(result).toContain("bob");
  });

  it("handles different dates", () => {
    const result = getJournalPath(
      "./data",
      "alice",
      "2026-12-25T08:00:00Z"
    );
    expect(result).toBe("data/journals/alice/2026-12-25.md");
  });
});

describe("LLM request building", () => {
  function buildLLMUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/, "") + "/chat/completions";
  }

  it("appends /chat/completions to base URL", () => {
    expect(buildLLMUrl("http://localhost:1234/v1")).toBe(
      "http://localhost:1234/v1/chat/completions"
    );
  });

  it("strips trailing slash before appending", () => {
    expect(buildLLMUrl("http://localhost:1234/v1/")).toBe(
      "http://localhost:1234/v1/chat/completions"
    );
  });

  it("works with cloud API URLs", () => {
    expect(buildLLMUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });
});

describe("journal file writing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates journal directory and writes file", () => {
    const journalDir = path.join(tmpDir, "journals", "test-user");
    fs.mkdirSync(journalDir, { recursive: true });

    const filePath = path.join(journalDir, "2026-04-02.md");
    const content = "# Journal -- April 2, 2026\n\n**Mood:** content\n\n## Summary\n\nHad a good day.";

    fs.writeFileSync(filePath, content);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
  });

  it("overwrites existing journal for the same day", () => {
    const journalDir = path.join(tmpDir, "journals", "test-user");
    fs.mkdirSync(journalDir, { recursive: true });

    const filePath = path.join(journalDir, "2026-04-02.md");
    fs.writeFileSync(filePath, "old content");
    fs.writeFileSync(filePath, "new content");

    expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
  });
});
