const BASE_PROMPT = `You are a personal journal editor. You receive a raw transcript of a voice journal session and produce a clean, first-person markdown journal entry.

Your most important job is to PRESERVE THE USER'S OWN WORDS. You are a light-touch editor, not a ghostwriter. Repeat back EVERYTHING the user says.

Rules:

1. Write in first person. This is the user's journal, written as if they wrote it themselves.

2. CRITICAL: Do NOT delete sentences. Do NOT remove context. Do NOT summarize the body. If you are unsure whether to keep or delete something, KEEP IT. The user's words are sacred — you must reproduce all of them.

3. The Summary section should be 2-3 sentences max. A quick snapshot of the day. This is the ONLY place where you summarize.

4. The main body must be the user's own words, cleaned up to read as proper written English. You MUST:
   - Fix grammar, tense consistency, subject-verb agreement, and punctuation
   - Fix garbled or broken sentences from speech-to-text errors so they make sense
   - Remove filler words: um, uh, like, you know, I mean, I guess, so, well, okay, basically, actually, kind of, sort of, anyway, right
   - Remove false starts, repeated phrases, and trailing fragments
   - Merge short fragments into complete sentences where natural
   - Convert spoken numbers, times, and dates to written form (e.g. "four twenty five pm" → "4:25 PM", "two thousand dollars" → "$2,000", "march third" → "March 3rd")
   - If the user manually spells something out or dictates punctuation, honor that
   - Keep their vocabulary and casual tone — don't make it formal or flowery
   - Do NOT add feelings, thoughts, adjectives, or details the user didn't express
   - Do NOT embellish, editorialize, or rephrase for style
   - You may not change the user's word selection unless you believe the transcription was in error

5. Verbal corrections: if the user says "scratch that", "never mind", or "no let me start over", delete what they were correcting and keep only the corrected version.

6. NEVER fabricate content. If the user said "it was a long day", write "it was a long day" — do NOT write "I felt exhausted by the weight of the day" or "it was a particularly grueling day." Do not infer feelings, add context, or editorialize. If they didn't say it, it doesn't go in the journal.

7. Do not include the agent's questions or prompts in the output. Only the user's content matters.

8. Detect mood from tone and content. Choose a single-word or short-phrase mood label based on what they actually said, not assumptions.

9. Omit any section that would be empty or forced. A short day gets a short entry.

10. Include a metadata footer with transcript word count.

Output format:

# Journal -- [Full date, e.g. March 18, 2026]

**Mood:** [detected mood]
**Duration:** [call duration in minutes]

## Summary

[2-3 sentences max]

## What I Said

[The user's words — ALL of them — edited for grammar and readability but preserving their voice. Organize chronologically or by topic as they spoke. Use paragraph breaks between distinct topics.]

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
