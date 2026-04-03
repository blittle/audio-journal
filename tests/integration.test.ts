import { describe, it, expect } from "vitest";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../src/prompts/summarize.js";

const LLM_BASE_URL = "http://127.0.0.1:8000/api/v1";
const LLM_MODEL = "Qwen3.5-35B-A3B-GGUF";

const SAMPLE_TRANSCRIPT = `Assistant: Hey, how was your day?
User: Oh man, it was kind of a rollercoaster honestly. Started off rough because I overslept and missed my morning standup at work. My manager pinged me about it which was embarrassing.
Assistant: That sounds frustrating.
User: Yeah, it was. But then things got better. I finally fixed that authentication bug I've been wrestling with for three days. Turned out it was a race condition in the token refresh logic. Felt really good to crack that one.
Assistant: Was there anything else today that stuck with you?
User: Actually yeah, I had lunch with my friend Sarah. We went to that new ramen place downtown. The food was incredible but we mostly talked about her startup idea. She wants to build something in the health tech space and asked if I'd be interested in doing some contract work on the side. I'm kind of tempted but also nervous about taking on too much.
Assistant: Is that something you're still thinking about?
User: Definitely. I mean, my day job is fine but it's not super exciting anymore. The startup thing sounds fun but risky. I told her I'd think about it over the weekend. Also I went for a run after work which helped clear my head. Did about 5K along the river trail. The weather was perfect.
Assistant: How are you feeling right now, heading into the evening?
User: Pretty good actually. Tired but in a satisfied way. Like, today had its ups and downs but overall it was productive. I'm just going to watch some TV and get to bed early tonight.
Assistant: Good stuff. Talk to you tomorrow.`;

async function callLocalLLM(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LLM returned ${response.status}: ${await response.text()}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

describe("local LLM integration", () => {
  it("generates a journal entry from a sample transcript", { timeout: 120_000 }, async () => {
    const userPrompt = buildUserPrompt(
      SAMPLE_TRANSCRIPT,
      "2026-04-02T20:00:00-06:00",
      5
    );

    const result = await callLocalLLM(SUMMARIZE_SYSTEM_PROMPT, userPrompt);

    // Verify the output has the expected journal structure
    expect(result).toContain("Journal");
    expect(result).toContain("Mood:");
    expect(result).toContain("Summary");
    expect(result).toContain("What Happened");

    // Should be first-person
    expect(result).toContain("I ");

    // Should include key events from the transcript
    expect(result.toLowerCase()).toContain("authentication");
    expect(result.toLowerCase()).toContain("ramen");

    // Should NOT include the agent's questions
    expect(result).not.toContain("Hey, how was your day?");
    expect(result).not.toContain(
      "Was there anything else today that stuck with you?"
    );

    // Should have transcript word count in footer
    expect(result).toContain("Transcript word count:");

    console.log("\n--- Generated Journal Entry ---\n");
    console.log(result);
    console.log("\n--- End ---\n");
  });

  it("handles a very short transcript with minimal output", { timeout: 120_000 }, async () => {
    const shortTranscript = `Assistant: Hey, how was your day?
User: Fine, nothing special really. Pretty quiet.
Assistant: Got it all. Sleep well.`;

    const userPrompt = buildUserPrompt(
      shortTranscript,
      "2026-04-02T20:00:00-06:00",
      1
    );

    const result = await callLocalLLM(SUMMARIZE_SYSTEM_PROMPT, userPrompt);

    // Should still produce something with at minimum a summary
    expect(result).toContain("Journal");
    expect(result).toContain("Summary");

    // Should be relatively short given the short input
    expect(result.length).toBeLessThan(2000);

    console.log("\n--- Short Journal Entry ---\n");
    console.log(result);
    console.log("\n--- End ---\n");
  });

  it("detects mood appropriately from emotional transcript", { timeout: 120_000 }, async () => {
    const emotionalTranscript = `Assistant: What stood out to you about today?
User: Honestly it was really tough. I found out my project at work is getting cancelled. I've been working on it for six months and they just pulled the plug. I feel pretty defeated. Like, what was the point of all that effort?
Assistant: That sounds hard.
User: Yeah. I know it's just business decisions but it still stings. I'm worried about what this means for my role going forward. Might need to start looking at other options.
Assistant: Anything else before we wrap up?
User: No, I think I just needed to get that off my chest. Thanks for listening.
Assistant: Thanks for sharing. Have a good night.`;

    const userPrompt = buildUserPrompt(
      emotionalTranscript,
      "2026-04-02T20:00:00-06:00",
      3
    );

    const result = await callLocalLLM(SUMMARIZE_SYSTEM_PROMPT, userPrompt);

    // Mood should reflect negative/difficult feelings
    const moodMatch = result.match(/\*\*Mood:\*\*\s*(.+)/);
    expect(moodMatch).not.toBeNull();
    const mood = moodMatch![1].toLowerCase();
    const negativeMoods = [
      "defeat",
      "frustrat",
      "disappoint",
      "discourag",
      "upset",
      "down",
      "tough",
      "difficult",
      "anxious",
      "worried",
      "dishearten",
    ];
    const hasNegativeMood = negativeMoods.some((m) => mood.includes(m));
    expect(
      hasNegativeMood,
      `Expected negative mood, got: "${mood}"`
    ).toBe(true);

    // Should include "How I'm Feeling" section for emotional content
    expect(result).toContain("How I'm Feeling");

    console.log("\n--- Emotional Journal Entry ---\n");
    console.log(result);
    console.log("\n--- End ---\n");
  });
});
