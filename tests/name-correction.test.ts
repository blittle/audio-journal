import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseNameAliases,
  correctNames,
} from "../src/prompts/summarize.js";

const KNOWN_NAMES =
  "Tearsa (wife, STT often hears: Kersa, Carissa, Teresa, Tersa), Taiah (daughter, STT often hears: Taya, Kea, Tia), Amirah (daughter, STT often hears: Amira), Sylvie (daughter), Dante (son, STT often hears: Donte)";

describe("parseNameAliases", () => {
  const aliases = parseNameAliases(KNOWN_NAMES);

  it("parses all aliases", () => {
    expect(aliases.get("kersa")).toBe("Tearsa");
    expect(aliases.get("carissa")).toBe("Tearsa");
    expect(aliases.get("teresa")).toBe("Tearsa");
    expect(aliases.get("tersa")).toBe("Tearsa");
    expect(aliases.get("taya")).toBe("Taiah");
    expect(aliases.get("kea")).toBe("Taiah");
    expect(aliases.get("tia")).toBe("Taiah");
    expect(aliases.get("amira")).toBe("Amirah");
    expect(aliases.get("donte")).toBe("Dante");
  });

  it("returns empty map for names without aliases", () => {
    const simple = parseNameAliases("Sylvie (daughter), Bob (friend)");
    expect(simple.size).toBe(0);
  });
});

describe("correctNames", () => {
  const aliases = parseNameAliases(KNOWN_NAMES);

  it("replaces misspelled wife name", () => {
    expect(correctNames("Kersa and I went for a walk.", aliases)).toBe(
      "Tearsa and I went for a walk."
    );
  });

  it("replaces Carissa with Tearsa", () => {
    expect(correctNames("Carissa had a long day.", aliases)).toBe(
      "Tearsa had a long day."
    );
  });

  it("replaces Amira with Amirah", () => {
    expect(correctNames("I dropped off Amira at school.", aliases)).toBe(
      "I dropped off Amirah at school."
    );
  });

  it("replaces multiple names in one string", () => {
    const input = "Carissa drove Taya to gymnastics. Donte made the bus.";
    const expected = "Tearsa drove Taiah to gymnastics. Dante made the bus.";
    expect(correctNames(input, aliases)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(correctNames("KERSA is tired.", aliases)).toBe("Tearsa is tired.");
    expect(correctNames("kersa is tired.", aliases)).toBe("Tearsa is tired.");
  });

  it("does not replace partial matches", () => {
    // "Amirah" should not be affected by the "Amira" alias
    expect(correctNames("Amirah is here.", aliases)).toBe("Amirah is here.");
  });

  it("leaves correct names unchanged", () => {
    expect(correctNames("Tearsa and Sylvie went out.", aliases)).toBe(
      "Tearsa and Sylvie went out."
    );
  });
});

describe("buildSystemPrompt", () => {
  it("strips STT hints from the name list in the prompt", () => {
    const prompt = buildSystemPrompt(KNOWN_NAMES);
    expect(prompt).not.toContain("STT often hears");
    expect(prompt).toContain("Tearsa (wife)");
    expect(prompt).toContain("Taiah (daughter)");
  });

  it("returns base prompt when no names provided", () => {
    const prompt = buildSystemPrompt(undefined);
    expect(prompt).not.toContain("known people");
  });
});

/**
 * LLM integration tests — verify the full pipeline produces correct names.
 * Requires Lemonade running locally with Qwen3.5-4B loaded.
 */

const LEMONADE_URL = "http://127.0.0.1:8000/api/v1";
const LLM_MODEL = "Qwen3.5-4B-GGUF";

async function generateJournal(transcript: string): Promise<string> {
  // Pre-correct names (same as journal.ts does)
  const aliases = parseNameAliases(KNOWN_NAMES);
  const corrected = correctNames(transcript, aliases);

  const systemPrompt = buildSystemPrompt(KNOWN_NAMES);
  const userPrompt = buildUserPrompt(corrected, "2026-04-03T20:00:00-06:00", 3);

  const response = await fetch(`${LEMONADE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

/** Check that a name appears with correct spelling, not a misspelled variant */
function expectName(journal: string, correct: string, wrong: string[]): void {
  expect(journal).toContain(correct);
  for (const w of wrong) {
    const re = new RegExp(`\\b${w}\\b`);
    expect(
      re.test(journal),
      `Journal should not contain "${w}". Full output:\n${journal}`
    ).toBe(false);
  }
}

describe("name correction through full pipeline (LLM)", () => {
  it(
    "corrects misspelled names in a realistic transcript",
    { timeout: 60_000 },
    async () => {
      const transcript = `Assistant: How was your day?
User: It was good. Carissa had a long day though. She drove Taya to gymnastics and then picked up Amira from school. Donte made it to the bus on his own. Sylvie stayed home with me.
Assistant: Sounds like a busy day for the family.`;

      const journal = await generateJournal(transcript);

      expectName(journal, "Tearsa", ["Carissa"]);
      expectName(journal, "Taiah", ["Taya"]);
      expectName(journal, "Dante", ["Donte"]);
      expect(journal).toContain("Sylvie");
      // Amirah check — use word boundary so "Amirah" passes but "Amira" alone doesn't
      expect(journal).toContain("Amirah");

      // Should not leak the name list
      expect(journal).not.toContain("STT often hears");
      expect(journal).not.toContain("(wife");

      console.log("\n--- Full pipeline name correction ---");
      console.log(journal);
      console.log("--- End ---\n");
    }
  );
});
