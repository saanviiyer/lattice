// Suggesting projects from what is already in the library.
//
// The hard part of a feature like this is not producing suggestions — anything
// can produce suggestions — it is producing ones a researcher will not roll their
// eyes at. So every proposal here is *derived*, never invented: it comes from
// counting what is actually in the library, and it carries the count with it.
// "You have 14 papers on active learning and 11 on antibody engineering, and one
// paper does both" is a suggestion you can check and disagree with. "Have you
// considered combining machine learning and biology?" is noise.
//
// Nothing here calls a model. A proposal that cannot be traced back to records
// you own has no business being in a library tool, and the app runs with no API
// key at all.

import type { Collection, Paper, ResearchQuestion } from "../types";
import { FIELDS, type Field } from "./fieldLexicon";
import { proposeSubjectGroups } from "./subjectGroups";

export type ProposalKind =
  | "method-transfer"
  | "question-ready"
  | "unclaimed-reading"
  | "thin-premise";

export interface ResearchProposal {
  id: string;
  kind: ProposalKind;
  /** A name for the project this would become. */
  title: string;
  /** A first-draft claim, stated so it could turn out to be wrong. */
  premise: string;
  /** Why this is being suggested, in terms of what is in the library. */
  rationale: string;
  /** The papers that justify it, and that a project would start from. */
  paperIds: string[];
  questionIds: string[];
  /** Ordering only; not a claim about how good the idea is. */
  strength: number;
}

/** Words of a paper that a field can be matched against. */
export function paperText(paper: Paper): string {
  return `${paper.title || ""} ${(paper.abstract || "").slice(0, 600)} ${paper.tags.join(" ")}`.toLowerCase();
}

// Single words that appear all over the literature in unrelated senses. A paper
// is not about protein folding because something "folds", nor about attention
// mechanisms because a sentence says "attention". These need corroboration; every
// other single word in a field's vocabulary is taken at face value.
export const AMBIGUOUS = new Set([
  "fold", "attention", "flow", "contact", "design", "model", "learning", "network",
  "sequence", "structure", "function", "transfer", "active", "safe", "image",
  "agent", "policy", "expression", "family", "alignment", "simulation", "engineer",
  "engineering", "prediction", "evaluate", "evaluation", "token", "sampling",
]);

/**
 * Whether a paper is actually about a field.
 *
 * A multi-word term settles it on its own — a paper saying "protein language
 * model" is about protein language models — and so does an unambiguous single
 * word like "antibody" or "generative". Ambiguous words need a partner.
 *
 * Terms that are prefixes of one another ("engineer", "engineering") count once,
 * or one word in the text would satisfy a two-word rule by itself.
 */
export function isAbout(text: string, field: Field): boolean {
  const matched: string[] = [];
  for (const term of field.terms) {
    if (!text.includes(term)) continue;
    if (term.includes(" ") || !AMBIGUOUS.has(term)) return true;
    if (!matched.some((seen) => seen.includes(term) || term.includes(seen))) matched.push(term);
  }
  return matched.length >= 2;
}

/**
 * Which fields each paper is about, by looking for the field's own vocabulary.
 *
 * A paper can be in several: that is the point — a paper in both a method and a
 * domain is exactly the evidence that the combination is not novel.
 */
function fieldsOfPapers(papers: Paper[]): Map<string, Set<string>> {
  const byField = new Map<string, Set<string>>();
  for (const field of FIELDS) byField.set(field.name, new Set());
  for (const paper of papers) {
    const text = paperText(paper);
    for (const field of FIELDS) {
      if (isAbout(text, field)) byField.get(field.name)!.add(paper.id);
    }
  }
  return byField;
}

export interface ProposalOptions {
  /** A field needs at least this many papers before it is worth proposing from. */
  minFieldSize?: number;
  /** Above this many papers already doing both, the combination is not new to you. */
  maxExisting?: number;
  limit?: number;
}

export function proposeResearch(
  papers: Paper[],
  questions: ResearchQuestion[],
  collections: Collection[],
  options: ProposalOptions = {}
): ResearchProposal[] {
  const minFieldSize = options.minFieldSize ?? 5;
  const maxExisting = options.maxExisting ?? 1;
  const limit = options.limit ?? 8;

  const proposals: ResearchProposal[] = [];
  const byField = fieldsOfPapers(papers);
  const byId = new Map(papers.map((paper) => [paper.id, paper]));
  const methods = FIELDS.filter((field) => field.kind === "method");
  const domains = FIELDS.filter((field) => field.kind === "domain");

  // ---- 1. A method you read about, and a domain you read about, that you have
  // not yet put together. The most useful shape of suggestion, because both
  // halves are things you already care about.
  for (const method of methods) {
    const methodPapers = byField.get(method.name)!;
    if (methodPapers.size < minFieldSize) continue;
    for (const domain of domains) {
      const domainPapers = byField.get(domain.name)!;
      if (domainPapers.size < minFieldSize) continue;
      const both = [...methodPapers].filter((id) => domainPapers.has(id));
      if (both.length > maxExisting) continue;

      const evidence = [
        ...both,
        ...[...methodPapers].filter((id) => !both.includes(id)).slice(0, 5),
        ...[...domainPapers].filter((id) => !both.includes(id)).slice(0, 5),
      ];
      proposals.push({
        id: `transfer:${method.name}:${domain.name}`,
        kind: "method-transfer",
        title: `${method.name} for ${domain.name.toLowerCase()}`,
        premise: `${method.name} can be applied to ${domain.name.toLowerCase()} to do something the current approaches there cannot.`,
        rationale:
          `${methodPapers.size} papers on ${method.name.toLowerCase()} and ${domainPapers.size} on ${domain.name.toLowerCase()}, ` +
          (both.length === 0
            ? "and none that do both."
            : `and only ${both.length} that does both.`),
        paperIds: evidence,
        questionIds: [],
        // Both sides being well read matters more than either being large.
        strength: Math.min(methodPapers.size, domainPapers.size) * 2 - both.length * 3,
      });
    }
  }

  // ---- 2. A question you have already gathered evidence for. This is a project
  // you have started without noticing.
  for (const question of questions) {
    if (question.status === "resolved") continue;
    const evidence = question.linkedPaperIds.filter((id) => byId.has(id));
    if (evidence.length < 3) continue;
    const alreadyFiled = (question.collectionIds || []).length > 0;
    if (alreadyFiled) continue;
    proposals.push({
      id: `question:${question.id}`,
      kind: "question-ready",
      title: question.title,
      premise: question.detail?.trim() || `An answer to: ${question.title}`,
      rationale: `You have already attached ${evidence.length} papers to this question, and it is not in a project yet.`,
      paperIds: evidence,
      questionIds: [question.id],
      strength: evidence.length * 3,
    });
  }

  // ---- 3. Reading you have done that no project or question claims. A body of
  // papers with nothing asked of it is either a project waiting to be named or
  // reading you should stop doing.
  const claimed = new Set<string>();
  for (const paper of papers) if (paper.collectionIds.length) claimed.add(paper.id);
  for (const question of questions) for (const id of question.linkedPaperIds) claimed.add(id);
  const loose = papers.filter((paper) => !claimed.has(paper.id));
  if (loose.length >= minFieldSize) {
    const { groups } = proposeSubjectGroups(
      loose.map((paper) => ({
        id: paper.id,
        title: paper.title || "",
        tags: paper.tags,
        abstract: paper.abstract || "",
      })),
      { minSize: minFieldSize }
    );
    for (const group of groups.slice(0, 3)) {
      proposals.push({
        id: `unclaimed:${group.id}`,
        kind: "unclaimed-reading",
        title: group.label,
        premise: `There is something worth stating about ${group.label.toLowerCase()} — ${group.documentIds.length} papers were worth reading, so say what they add up to.`,
        rationale: `${group.documentIds.length} papers on this, in no project and attached to no question.`,
        paperIds: group.documentIds,
        questionIds: [],
        strength: group.documentIds.length * 2,
      });
    }
  }

  // ---- 4. A claim you have made and not backed. Stated premises with almost no
  // evidence behind them are the ones most likely to be wrong.
  for (const collection of collections) {
    const premise = collection.premise?.trim();
    if (!premise) continue;
    const filed = papers.filter((paper) => paper.collectionIds.includes(collection.id));
    if (filed.length >= 3 || filed.length === 0) continue;
    proposals.push({
      id: `thin:${collection.id}`,
      kind: "thin-premise",
      title: `Evidence for “${collection.name}”`,
      premise,
      rationale: `You have stated this premise but filed only ${filed.length} paper${filed.length === 1 ? "" : "s"} behind it.`,
      paperIds: filed.map((paper) => paper.id),
      questionIds: [],
      strength: 6 - filed.length,
    });
  }

  const ranked = proposals.sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));

  // One proposal per method and per domain, so the list is a set of different
  // ideas rather than ten variations on one.
  const usedHalves = new Set<string>();
  const distinct = ranked.filter((proposal) => {
    if (proposal.kind !== "method-transfer") return true;
    const [, method, domain] = proposal.id.split(":");
    if (usedHalves.has(method) || usedHalves.has(domain)) return false;
    usedHalves.add(method);
    usedHalves.add(domain);
    return true;
  });

  // Method transfers are combinatorial and would otherwise fill the list on their
  // own, burying the suggestions drawn from what you have actually written — a
  // question you already gathered evidence for is a better lead than any pairing
  // of two fields.
  const transfers = distinct.filter((p) => p.kind === "method-transfer");
  const grounded = distinct.filter((p) => p.kind !== "method-transfer");
  return [...grounded, ...transfers.slice(0, Math.max(3, limit - grounded.length))]
    .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
    .slice(0, limit);
}
