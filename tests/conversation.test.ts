import { describe, it, expect } from "vitest";
import { pickOpener, buildSystemPrompt } from "../src/prompts/conversation.js";
import type { User } from "../src/users.js";

const testUser: User = {
  id: "test-user",
  phoneNumber: "+15551234567",
  callTime: "20:00",
  timezone: "America/Denver",
  conversationStyle: "casual",
  enabled: true,
};

describe("pickOpener", () => {
  it("returns a string from the casual pool", () => {
    const opener = pickOpener("casual", null);
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("returns a string from the reflective pool", () => {
    const opener = pickOpener("reflective", null);
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("returns a string from the structured pool", () => {
    const opener = pickOpener("structured", null);
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("does not repeat the last used opener", () => {
    const lastUsed = "Hey, how was your day?";
    // Run many times to check it never returns the same one
    for (let i = 0; i < 50; i++) {
      const opener = pickOpener("casual", lastUsed);
      expect(opener).not.toBe(lastUsed);
    }
  });

  it("handles null lastUsedOpener gracefully", () => {
    const opener = pickOpener("casual", null);
    expect(typeof opener).toBe("string");
  });
});

describe("buildSystemPrompt", () => {
  it("includes the selected opener", () => {
    const opener = "Hey, how was your day?";
    const prompt = buildSystemPrompt(testUser, opener);
    expect(prompt).toContain(opener);
  });

  it("includes the user id", () => {
    const prompt = buildSystemPrompt(testUser, "Tell me about your day.");
    expect(prompt).toContain("test-user");
  });

  it("includes conversation rules", () => {
    const prompt = buildSystemPrompt(testUser, "Tell me about your day.");
    expect(prompt).toContain("listener, not a therapist");
    expect(prompt).toContain("1-2 sentences max");
    expect(prompt).toContain("yes/no questions");
    expect(prompt).toContain("Match the user's energy");
  });

  it("includes follow-up prompts", () => {
    const prompt = buildSystemPrompt(testUser, "Tell me about your day.");
    expect(prompt).toContain("How did that make you feel?");
    expect(prompt).toContain("What happened next?");
    expect(prompt).toContain("Anything else before we wrap up?");
  });

  it("includes closing lines", () => {
    const prompt = buildSystemPrompt(testUser, "Tell me about your day.");
    expect(prompt).toContain("Sleep well");
    expect(prompt).toContain("Talk to you tomorrow");
  });

  it("includes control phrase handling", () => {
    const prompt = buildSystemPrompt(testUser, "Tell me about your day.");
    expect(prompt).toContain("call me back");
    expect(prompt).toContain("skip today");
  });
});
