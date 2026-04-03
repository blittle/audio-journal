import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

// Test the user schema validation independently (same schema as users.ts)
const userSchema = z.object({
  id: z.string().min(1),
  phoneNumber: z.string().min(1),
  callTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  timezone: z.string(),
  conversationStyle: z
    .enum(["casual", "reflective", "structured"])
    .default("casual"),
  enabled: z.boolean().default(true),
});

describe("user schema validation", () => {
  const validUser = {
    id: "test-user",
    phoneNumber: "+15551234567",
    callTime: "20:00",
    timezone: "America/Denver",
    conversationStyle: "casual",
    enabled: true,
  };

  it("accepts a valid user", () => {
    const result = userSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it("applies defaults for conversationStyle and enabled", () => {
    const result = userSchema.parse({
      id: "minimal",
      phoneNumber: "+15551234567",
      callTime: "20:00",
      timezone: "UTC",
    });
    expect(result.conversationStyle).toBe("casual");
    expect(result.enabled).toBe(true);
  });

  it("rejects empty id", () => {
    const result = userSchema.safeParse({ ...validUser, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty phoneNumber", () => {
    const result = userSchema.safeParse({ ...validUser, phoneNumber: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid callTime format", () => {
    for (const bad of ["8pm", "20:0", "2000", "8:00pm"]) {
      const result = userSchema.safeParse({ ...validUser, callTime: bad });
      expect(result.success, `should reject "${bad}"`).toBe(false);
    }
  });

  it("accepts valid callTime formats", () => {
    for (const good of ["00:00", "08:30", "20:00", "23:59"]) {
      const result = userSchema.safeParse({ ...validUser, callTime: good });
      expect(result.success, `should accept "${good}"`).toBe(true);
    }
  });

  it("rejects invalid conversationStyle", () => {
    const result = userSchema.safeParse({
      ...validUser,
      conversationStyle: "verbose",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid conversation styles", () => {
    for (const style of ["casual", "reflective", "structured"]) {
      const result = userSchema.safeParse({
        ...validUser,
        conversationStyle: style,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("users.json parsing", () => {
  it("validates an array of users", () => {
    const usersArray = [
      {
        id: "alice",
        phoneNumber: "+15551111111",
        callTime: "20:00",
        timezone: "America/Denver",
      },
      {
        id: "bob",
        phoneNumber: "+15552222222",
        callTime: "21:30",
        timezone: "America/New_York",
        conversationStyle: "reflective",
      },
    ];

    const result = z.array(userSchema).safeParse(usersArray);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].conversationStyle).toBe("casual"); // default
      expect(result.data[1].conversationStyle).toBe("reflective"); // explicit
    }
  });

  it("rejects if any user in array is invalid", () => {
    const usersArray = [
      {
        id: "valid",
        phoneNumber: "+15551111111",
        callTime: "20:00",
        timezone: "America/Denver",
      },
      {
        id: "",
        phoneNumber: "+15552222222",
        callTime: "20:00",
        timezone: "America/Denver",
      },
    ];

    const result = z.array(userSchema).safeParse(usersArray);
    expect(result.success).toBe(false);
  });

  it("rejects non-array input", () => {
    const result = z.array(userSchema).safeParse({ id: "not-array" });
    expect(result.success).toBe(false);
  });
});
