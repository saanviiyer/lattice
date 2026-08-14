// AI actions for lattice. Uses the Anthropic SDK when ANTHROPIC_API_KEY is set;
// otherwise returns realistic MOCK results so the whole app is usable with zero setup.
//
// Two actions:
//   explainHighlight(text, context) -> { explanation }
//   synthesizeNote(paperTitle, highlights) -> { note }  (markdown, with [[wikilink]])
import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
export const MOCK_MODE = !API_KEY;
export const MODEL = "claude-sonnet-5";

const client = MOCK_MODE ? null : new Anthropic({ apiKey: API_KEY });

const EXPLAIN_SYSTEM = `You are lattice's reading assistant. A researcher highlighted a passage in a paper
and wants a clear, grounded explanation of it. Explain what the passage means in plain language, define any
jargon, and note why it might matter. Ground every claim in the passage and any surrounding context provided.
Do not invent findings, citations, or numbers that are not in the text. Keep it to a short paragraph or two.`;

const SYNTH_SYSTEM = `You are lattice's note-writing assistant. A researcher has collected highlights from a
single paper and wants them synthesized into a concise study note in Markdown. Group related highlights, keep
the researcher's own emphasis, and stay grounded in the highlighted text (do not add facts not present in it).
Begin the note with a link to the paper using lattice wikilink syntax: [[Paper Title]]. Use short Markdown
sections and bullet points. Do not fabricate quotes.`;

// ---------------------------------------------------------------------------
// MOCK MODE builders — believable, grounded-looking output from the real inputs.
// ---------------------------------------------------------------------------
function mockExplain(text, context) {
  const snippet = (text || "").replace(/\s+/g, " ").trim();
  const short = snippet.length > 160 ? snippet.slice(0, 160) + "…" : snippet;
  const ctx = (context || "").trim();
  return (
    `This passage states: "${short}". ` +
    `In plain terms, it is making a claim that the surrounding argument depends on` +
    (ctx ? `, and it sits alongside related discussion in the paper. ` : ". ") +
    `Read it as a load-bearing sentence: identify the subject, the property being asserted, and the ` +
    `evidence the authors point to. ` +
    `(This is a MOCK explanation generated with no API key. Set ANTHROPIC_API_KEY for a live ` +
    `explanation from ${MODEL}.)`
  );
}

function mockSynthesize(paperTitle, highlights) {
  const title = paperTitle || "Untitled paper";
  const lines = [];
  lines.push(`Notes on [[${title}]]`.replace(/^/, "# "));
  lines.push("");
  lines.push(
    `A synthesis of ${highlights.length} highlight${
      highlights.length === 1 ? "" : "s"
    } collected from this paper.`
  );
  lines.push("");
  lines.push("## Key passages");
  lines.push("");
  for (const h of highlights.slice(0, 12)) {
    const t = (h.text || "").replace(/\s+/g, " ").trim();
    const short = t.length > 180 ? t.slice(0, 180) + "…" : t;
    const note = (h.note || "").trim();
    lines.push(`- ${short}${note ? ` (note: ${note})` : ""} (p.${h.page || "?"})`);
  }
  lines.push("");
  lines.push(
    `_This is a MOCK synthesis generated with no API key. Set ANTHROPIC_API_KEY for a live ` +
      `synthesis from ${MODEL}._`
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------
export async function explainHighlight(text, context) {
  if (!text || !text.trim()) throw new Error("No highlighted text to explain.");
  if (MOCK_MODE) {
    return { mockMode: true, explanation: mockExplain(text, context) };
  }
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: EXPLAIN_SYSTEM,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content:
          `Highlighted passage:\n"""${text}"""\n\n` +
          (context ? `Surrounding context:\n"""${context}"""\n\n` : "") +
          `Explain the highlighted passage.`,
      },
    ],
  });
  const explanation = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { mockMode: false, explanation };
}

export async function synthesizeNote(paperTitle, highlights) {
  if (!Array.isArray(highlights) || highlights.length === 0) {
    throw new Error("This paper has no highlights to synthesize.");
  }
  if (MOCK_MODE) {
    return { mockMode: true, note: mockSynthesize(paperTitle, highlights) };
  }
  const body = highlights
    .map((h, i) => {
      const t = (h.text || "").replace(/\s+/g, " ").trim();
      const note = (h.note || "").trim();
      return `[${i + 1}] (p.${h.page || "?"}) ${t}${note ? `\n    note: ${note}` : ""}`;
    })
    .join("\n");
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYNTH_SYSTEM,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content:
          `Paper title: ${paperTitle || "Untitled paper"}\n\n` +
          `Highlights:\n${body}\n\n` +
          `Synthesize these into a concise Markdown study note. Start with [[${
            paperTitle || "Untitled paper"
          }]].`,
      },
    ],
  });
  const note = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { mockMode: false, note };
}
