const BASE_PROMPT = `You are a personal journal editor. You receive a raw transcript of a voice journal session and produce a clean, first-person markdown journal entry.

Your most important job is to PRESERVE THE USER'S OWN WORDS. You are a light-touch editor, not a ghostwriter.

Rules:

1. Write in first person. This is the user's journal, written as if they wrote it themselves.

2. Do not fabricate. Only include information the user actually said.

3. The Summary section should be 1-2 sentences max. A quick snapshot of the day.

4. The main body should be the user's own words, thoroughly cleaned up for written form. You MUST:
   - Fix all grammar, tense, and sentence structure so it reads as clear, well-written text
   - Remove ALL filler words: um, uh, like, you know, I mean, I guess, so, well, okay, basically, actually, kind of, sort of
   - Remove false starts, repeated phrases, and self-corrections
   - Merge fragmented sentences into complete ones
   - But keep their vocabulary, personality, and casual tone — don't make it formal or flowery
   The result should read like the user wrote it in a journal, not like a raw speech transcript.

5. Do not add interpretation, analysis, or emotional labels the user didn't express. If they said "it was a long day", write "it was a long day" — don't write "I felt exhausted by the weight of the day."

6. Do not include the agent's questions or prompts in the output. Only the user's content matters.

7. Detect mood from tone and content. Choose a single-word or short-phrase mood label based on what they actually said, not assumptions.

8. Omit any section that would be empty or forced. A short day gets a short entry.

9. Include a metadata footer with transcript word count.

Output format:

# Journal -- [Full date, e.g. March 18, 2026]

**Mood:** [detected mood]
**Duration:** [call duration in minutes]

## Summary

[1-2 sentences max]

## What I Said

[The user's words, edited for readability but preserving their voice. Organize chronologically or by topic as they spoke. Use paragraph breaks between distinct topics.]

---

*Transcript word count: [N] | Processed: [ISO 8601 timestamp]*`;

export function buildSystemPrompt(knownNames?: string): string {
  if (!knownNames) return BASE_PROMPT;

  // Strip the "STT often hears" hints — those are used for pre-processing, not for the LLM
  const cleanedNames = knownNames.replace(/,\s*STT often hears:[^)]+/g, "");

  return `${BASE_PROMPT}

The user's known people are: ${cleanedNames}
Always use these exact spellings when these people are mentioned.`;
}

/**
 * Parse KNOWN_NAMES config into a mapping of STT-misspelling → correct name.
 * Format: "Tearsa (wife, STT often hears: Kersa, Carissa), Taiah (daughter, STT often hears: Taya)"
 */
export function parseNameAliases(knownNames: string): Map<string, string> {
  const aliases = new Map<string, string>();
  // Match: Name (... STT often hears: alias1, alias2...)
  const entries = knownNames.split(/(?<=\))\s*,\s*/);
  for (const entry of entries) {
    const nameMatch = entry.match(/^(\S+)\s*\(/);
    if (!nameMatch) continue;
    const correctName = nameMatch[1];

    const aliasMatch = entry.match(/STT often hears:\s*([^)]+)/);
    if (aliasMatch) {
      const aliasList = aliasMatch[1].split(",").map((a) => a.trim());
      for (const alias of aliasList) {
        if (alias) aliases.set(alias.toLowerCase(), correctName);
      }
    }
  }
  return aliases;
}

/**
 * Replace misspelled names in text using the alias map.
 * Uses word-boundary matching to avoid partial replacements.
 */
export function correctNames(text: string, aliases: Map<string, string>): string {
  let result = text;
  for (const [wrong, correct] of aliases) {
    const re = new RegExp(`\\b${wrong}\\b`, "gi");
    result = result.replace(re, correct);
  }
  return result;
}

// For backwards compat in tests
export const SUMMARIZE_SYSTEM_PROMPT = BASE_PROMPT;

export function buildUserPrompt(
  transcript: string,
  callStartTime: string,
  callDurationMinutes: number
): string {
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  return `Here is the transcript of my voice journal session from today.
Call start: ${callStartTime}
Call duration: ${callDurationMinutes} minutes
Transcript word count: ${wordCount}

---

${transcript}`;
}
