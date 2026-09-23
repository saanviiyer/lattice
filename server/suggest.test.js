// The suggester's rules, tested against a stubbed OpenAlex. The interesting cases are
// the guards: each one exists because the unguarded version produced wrong output
// against a real library, not because it seemed prudent.
import test from "node:test";
import assert from "node:assert/strict";

const responses = [];
const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  const body = responses.shift();
  if (!body) throw new Error(`unexpected request: ${url}`);
  return { ok: true, status: 200, json: async () => body };
};

const { suggestPapers } = await import("./suggest.js");

const work = (id, title, refs = []) => ({
  id: `https://openalex.org/${id}`,
  doi: `https://doi.org/10.1/${id.toLowerCase()}`,
  title,
  referenced_works: refs.map((r) => `https://openalex.org/${r}`),
});
const detail = (id, title, extra = {}) => ({
  id: `https://openalex.org/${id}`,
  doi: `https://doi.org/10.9/${id.toLowerCase()}`,
  title,
  publication_year: 2020,
  authorships: [{ author: { display_name: "Ada Lovelace" } }],
  primary_location: { source: { display_name: "Nature" } },
  cited_by_count: 10,
  ...extra,
});

function reset() {
  responses.length = 0;
  requested.length = 0;
}

test("ranks by how many separate seeds cite the same work", async () => {
  reset();
  responses.push({
    results: [
      work("W1", "Alpha paper", ["W90", "W91"]),
      work("W2", "Beta paper", ["W90", "W92"]),
      work("W3", "Gamma paper", ["W90", "W91"]),
    ],
  });
  responses.push({ results: [detail("W90", "Cited by three"), detail("W91", "Cited by two")] });

  const out = await suggestPapers({
    seeds: [
      { doi: "10.1/w1", title: "Alpha paper" },
      { doi: "10.1/w2", title: "Beta paper" },
      { doi: "10.1/w3", title: "Gamma paper" },
    ],
    exclude: [],
  });

  assert.deepEqual(
    out.suggestions.map((s) => s.title),
    ["Cited by three", "Cited by two"]
  );
  assert.equal(out.suggestions[0].seedCount, 3);
  // W92 is cited by one seed only, so it never reaches the reader.
  assert.equal(out.suggestions.length, 2);
});

test("drops a seed whose lookup came back as a different paper", async () => {
  // OpenAlex's arXiv DOI mapping is not always right. Seeding a project's reading from
  // somebody else's paper would be invisible in the output, so the title is checked.
  reset();
  responses.push({
    results: [
      work("W1", "Alpha paper on protein folding", ["W90"]),
      work("W2", "An entirely unrelated study of soil", ["W90", "W91"]),
      work("W3", "Gamma paper on protein folding", ["W90"]),
    ],
  });
  responses.push({ results: [detail("W90", "Shared reference")] });

  const out = await suggestPapers({
    seeds: [
      { doi: "10.1/w1", title: "Alpha paper on protein folding" },
      { doi: "10.1/w2", title: "Beta paper on protein folding" }, // mismatch
      { doi: "10.1/w3", title: "Gamma paper on protein folding" },
    ],
    exclude: [],
  });

  assert.equal(out.seedsUsed, 2);
  assert.deepEqual(out.unresolved, ["Beta paper on protein folding"]);
  // The mismatched seed contributed nothing, so W91 never appears.
  assert.equal(out.suggestions.every((s) => s.title !== "W91"), true);
});

test("refuses to answer from fewer than three seeds", async () => {
  // With one seed every entry in its bibliography scores 1: that is a reading list for
  // that paper, dressed up as a recommendation from the project.
  reset();
  responses.push({ results: [work("W1", "Only paper", ["W90", "W91", "W92"])] });

  const out = await suggestPapers({ seeds: [{ doi: "10.1/w1", title: "Only paper" }], exclude: [] });

  assert.equal(out.suggestions.length, 0);
  assert.equal(out.reason, "not-enough-seeds");
  assert.equal(requested.length, 1, "should not look up candidates it will not use");
});

test("says when the seeds simply have no bibliographies indexed", async () => {
  reset();
  responses.push({
    results: [work("W1", "Preprint one"), work("W2", "Preprint two"), work("W3", "Preprint three")],
  });

  const out = await suggestPapers({
    seeds: [
      { doi: "10.1/w1", title: "Preprint one" },
      { doi: "10.1/w2", title: "Preprint two" },
      { doi: "10.1/w3", title: "Preprint three" },
    ],
    exclude: [],
  });

  assert.equal(out.reason, "no-citation-data");
  assert.equal(out.suggestions.length, 0);
});

test("never suggests a paper the library already has", async () => {
  reset();
  responses.push({
    results: [
      work("W1", "Alpha", ["W90", "W91"]),
      work("W2", "Beta", ["W90", "W91"]),
      work("W3", "Gamma", ["W90", "W91"]),
    ],
  });
  responses.push({ results: [detail("W90", "Already owned"), detail("W91", "Genuinely new")] });

  const out = await suggestPapers({
    seeds: [
      { doi: "10.1/w1", title: "Alpha" },
      { doi: "10.1/w2", title: "Beta" },
      { doi: "10.1/w3", title: "Gamma" },
    ],
    exclude: ["https://doi.org/10.9/w90"], // the library's copy, as a URL form
  });

  assert.deepEqual(out.suggestions.map((s) => s.title), ["Genuinely new"]);
});

test("turns an arXiv id into a lookup, and rebuilds the abstract", async () => {
  reset();
  // The lookup is by the arXiv DOI form, so that is the DOI these come back carrying.
  responses.push({
    results: [
      { ...work("W1", "Alpha", ["W90"]), doi: "https://doi.org/10.48550/arxiv.2402.14905" },
      { ...work("W2", "Beta", ["W90"]), doi: "https://doi.org/10.48550/arxiv.2406.00244" },
      work("W3", "Gamma", ["W90"]),
    ],
  });
  responses.push({
    results: [
      detail("W90", "Reconstructed", {
        abstract_inverted_index: { Attention: [0], is: [1], all: [2], "you": [3], need: [4] },
      }),
    ],
  });

  const out = await suggestPapers({
    seeds: [
      { arxivId: "2402.14905", title: "Alpha" },
      { arxivId: "2406.00244v2", title: "Beta" },
      { doi: "10.1/w3", title: "Gamma" },
    ],
    exclude: [],
  });

  assert.match(requested[0], /10\.48550%2Farxiv\.2402\.14905/);
  assert.match(requested[0], /10\.48550%2Farxiv\.2406\.00244/, "version suffix should be stripped");
  assert.equal(out.suggestions[0].abstract, "Attention is all you need");
});

test("asks for nothing when no seed has an identifier", async () => {
  reset();
  const out = await suggestPapers({ seeds: [{ title: "No id at all" }], exclude: [] });
  assert.equal(out.reason, "no-identifiers");
  assert.equal(requested.length, 0);
});
