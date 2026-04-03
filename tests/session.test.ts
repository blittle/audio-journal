import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    SILENCE_THRESHOLD_MS: 1500,
  },
}));

import {
  ConversationSession,
  getSession,
  setSession,
  removeSession,
} from "../src/session.js";

describe("ConversationSession", () => {
  let session: ConversationSession;

  beforeEach(() => {
    session = new ConversationSession("CA-123", "test-user", "You are a journal companion.");
  });

  it("initializes with correct properties", () => {
    expect(session.callSid).toBe("CA-123");
    expect(session.userId).toBe("test-user");
    expect(session.streamSid).toBe("");
    expect(session.isProcessing).toBe(false);
  });

  it("stores system prompt as first message", () => {
    const messages = session.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a journal companion.",
    });
  });

  describe("audio buffer", () => {
    it("starts with no buffered audio", () => {
      expect(session.hasBufferedAudio()).toBe(false);
      expect(session.getBufferedAudio().length).toBe(0);
    });

    it("accumulates audio chunks", () => {
      session.appendAudio(new Int16Array([1, 2, 3]));
      session.appendAudio(new Int16Array([4, 5]));
      expect(session.hasBufferedAudio()).toBe(true);

      const buffered = session.getBufferedAudio();
      expect(buffered.length).toBe(5);
      expect(Array.from(buffered)).toEqual([1, 2, 3, 4, 5]);
    });

    it("clears audio buffer", () => {
      session.appendAudio(new Int16Array([1, 2, 3]));
      session.clearAudioBuffer();
      expect(session.hasBufferedAudio()).toBe(false);
    });
  });

  describe("silence tracking", () => {
    it("starts at zero", () => {
      expect(session.getSilentMs()).toBe(0);
    });

    it("increments silence", () => {
      session.incrementSilence(20);
      session.incrementSilence(20);
      expect(session.getSilentMs()).toBe(40);
    });

    it("resets silence", () => {
      session.incrementSilence(100);
      session.resetSilence();
      expect(session.getSilentMs()).toBe(0);
    });

    it("detects silence threshold", () => {
      expect(session.isSilenceThresholdReached()).toBe(false);
      session.incrementSilence(1500);
      expect(session.isSilenceThresholdReached()).toBe(true);
    });
  });

  describe("messages and transcript", () => {
    it("adds user and assistant messages", () => {
      session.addUserMessage("I had a great day");
      session.addAssistantMessage("That sounds nice!");

      const messages = session.getMessages();
      expect(messages).toHaveLength(3); // system + user + assistant
      expect(messages[1]).toEqual({ role: "user", content: "I had a great day" });
      expect(messages[2]).toEqual({ role: "assistant", content: "That sounds nice!" });
    });

    it("builds transcript from user and assistant turns", () => {
      session.addUserMessage("Hello");
      session.addAssistantMessage("Hi there");

      expect(session.getTranscript()).toBe("User: Hello\nAssistant: Hi there");
    });
  });

  describe("processing mutex", () => {
    it("allows starting processing", () => {
      expect(session.startProcessing()).toBe(true);
      expect(session.isProcessing).toBe(true);
    });

    it("prevents concurrent processing", () => {
      session.startProcessing();
      expect(session.startProcessing()).toBe(false);
    });

    it("allows restarting after finishing", () => {
      session.startProcessing();
      session.finishProcessing();
      expect(session.startProcessing()).toBe(true);
    });
  });

  describe("user spoke tracking", () => {
    it("starts with no speech", () => {
      expect(session.hasUserSpoken()).toBe(false);
    });

    it("tracks when user has spoken", () => {
      session.markUserSpoke();
      expect(session.hasUserSpoken()).toBe(true);
    });
  });

  describe("mark names", () => {
    it("generates sequential mark names", () => {
      expect(session.nextMarkName()).toBe("response-1");
      expect(session.nextMarkName()).toBe("response-2");
      expect(session.nextMarkName()).toBe("response-3");
    });
  });
});

describe("session store", () => {
  it("stores and retrieves sessions", () => {
    const session = new ConversationSession("CA-456", "user-2", "prompt");
    setSession("CA-456", session);
    expect(getSession("CA-456")).toBe(session);
  });

  it("returns undefined for unknown sessions", () => {
    expect(getSession("CA-nonexistent")).toBeUndefined();
  });

  it("removes sessions", () => {
    const session = new ConversationSession("CA-789", "user-3", "prompt");
    setSession("CA-789", session);
    const removed = removeSession("CA-789");
    expect(removed).toBe(session);
    expect(getSession("CA-789")).toBeUndefined();
  });
});
