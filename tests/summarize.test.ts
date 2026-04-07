import { describe, it, expect } from "vitest";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../src/prompts/summarize.js";

describe("SUMMARIZE_SYSTEM_PROMPT", () => {
  it("instructs first-person writing", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("first person");
  });

  it("includes required sections", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("## Summary");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("## What I Said");
  });

  it("includes mood detection instruction", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("Detect mood");
  });

  it("instructs to preserve user words", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("PRESERVE THE USER'S OWN WORDS");
  });

  it("instructs light-touch editing", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("light-touch editor");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("not a ghostwriter");
  });

  it("instructs to omit empty sections", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain(
      "Omit any section that would be empty"
    );
  });

  it("instructs to exclude agent questions", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain(
      "Do not include the agent's questions"
    );
  });

  it("includes metadata footer instruction", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("Transcript word count");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("Processed:");
  });

  it("includes the do not fabricate rule", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("NEVER fabricate");
  });

  it("instructs not to delete sentences", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("Do NOT delete sentences");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("Do NOT remove context");
  });

  it("instructs to handle verbal corrections", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("scratch that");
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("never mind");
  });

  it("instructs to convert spoken numbers", () => {
    expect(SUMMARIZE_SYSTEM_PROMPT).toContain("spoken numbers, times, and dates");
  });
});

describe("buildUserPrompt", () => {
  const transcript =
    "User: I had a really good day today. I went for a walk in the park and then had lunch with a friend.";

  it("includes the transcript", () => {
    const prompt = buildUserPrompt(transcript, "2026-04-02T20:00:00Z", 5);
    expect(prompt).toContain(transcript);
  });

  it("includes call start time", () => {
    const prompt = buildUserPrompt(transcript, "2026-04-02T20:00:00Z", 5);
    expect(prompt).toContain("2026-04-02T20:00:00Z");
  });

  it("includes call duration", () => {
    const prompt = buildUserPrompt(transcript, "2026-04-02T20:00:00Z", 5);
    expect(prompt).toContain("5 minutes");
  });

  it("calculates word count correctly", () => {
    const prompt = buildUserPrompt(
      "one two three four five",
      "2026-04-02T20:00:00Z",
      1
    );
    expect(prompt).toContain("Transcript word count: 5");
  });

  it("handles empty transcript word count", () => {
    const prompt = buildUserPrompt("", "2026-04-02T20:00:00Z", 0);
    expect(prompt).toContain("Transcript word count: 0");
  });
});
