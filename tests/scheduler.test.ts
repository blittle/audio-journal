import { describe, it, expect } from "vitest";

// Test the cron expression generation logic independently
function timeToCron(time: string): string {
  const [hour, minute] = time.split(":");
  return `${minute} ${hour} * * *`;
}

describe("timeToCron", () => {
  it("converts 20:00 to correct cron expression", () => {
    expect(timeToCron("20:00")).toBe("00 20 * * *");
  });

  it("converts 08:30 to correct cron expression", () => {
    expect(timeToCron("08:30")).toBe("30 08 * * *");
  });

  it("converts 00:00 (midnight) correctly", () => {
    expect(timeToCron("00:00")).toBe("00 00 * * *");
  });

  it("converts 23:59 correctly", () => {
    expect(timeToCron("23:59")).toBe("59 23 * * *");
  });

  it("converts 12:15 correctly", () => {
    expect(timeToCron("12:15")).toBe("15 12 * * *");
  });
});
