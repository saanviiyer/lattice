// AI actions for lattice. Uses the Anthropic SDK when ANTHROPIC_API_KEY is set;
// otherwise returns realistic MOCK results so the whole app is usable with zero setup.
//
// Three actions:
//   explainHighlight(text, context) -> { explanation }
//   synthesizeNote(paperTitle, highlights) -> { note }  (markdown, with [[wikilink]])
//   askLibrary(question, sources) -> { answer, sourceIds }
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

const ASK_SYSTEM = `You are lattice, a careful research companion. Answer the researcher's question only from
the library sources provided. Synthesize agreements, tensions, and gaps when the evidence allows it. Cite
sources inline as [1], [2], and so on. If the library cannot answer the question, say what is missing and
suggest a concrete next search. Never invent papers, findings, citations, or numbers. Keep the answer concise.`;

// ---------------------------------------------------------------------------
// MOCK MODE builders: believable, grounded-looking output from the real inputs.
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

export function mockAsk(question, sources) {
  const terms = new Set((question.toLowerCase().match(/[a-z]{4,}/g) || []));
  const ranked = sources
    .map((source) => {
      const text = `${source.title} ${source.abstract} ${source.takeaway}`.toLowerCase();
      const score = [...terms].filter((term) => text.includes(term)).length;
      return { ...source, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (!ranked.length) {
    return { mockMode: true, answer: "Your library does not contain enough material to answer this yet. Add a relevant paper or broaden the question.", sourceIds: [] };
  }
  const evidence = ranked.map((source, index) => {
    const claim = (source.takeaway || source.abstract || "No abstract or takeaway has been captured yet.")
      .replace(/\s+/g, " ").trim().slice(0, 220);
    return `- [${index + 1}] **${source.title}**: ${claim}`;
  }).join("\n");
  return {
    mockMode: true,
    answer: `Here is the strongest evidence currently in your library for **${question.trim()}**:\n\n${evidence}\n\n**Working conclusion.** These sources are the best starting set, but a grounded cross-paper conclusion needs richer takeaways or a live AI key. Treat this as a retrieval map, not a final claim.`,
    sourceIds: ranked.map((source) => source.id),
  };
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

export async function askLibrary(question, sources) {
  if (!question || !question.trim()) throw new Error("Ask a research question first.");
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("Add at least one paper before asking your library.");
  }
  if (MOCK_MODE) return mockAsk(question, sources);
  const corpus = sources.map((source, index) =>
    `[${index + 1}] ID: ${source.id}\nTitle: ${source.title}\nAuthors: ${(source.authors || []).join(", ")}\nYear: ${source.year || "unknown"}\nAbstract: ${source.abstract || "not available"}\nResearcher takeaway: ${source.takeaway || "not captured"}`
  ).join("\n\n");
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1800,
    system: ASK_SYSTEM,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: `Question: ${question}\n\nLibrary sources:\n${corpus}` }],
  });
  const answer = message.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]) - 1));
  const sourceIds = [...cited].map((index) => sources[index]?.id).filter(Boolean);
  return { mockMode: false, answer, sourceIds };
}
