// The arXiv client against a stubbed network. Each rule here exists because arXiv
// answered a real library with "429 Rate exceeded" and the old client made it worse.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LATTICE_ARXIV_INTERVAL_MS = "0";

let handler = () => {
  throw new Error("no handler installed");
};
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  return handler(String(url), options);
};

const { fetchByArxiv, isArxivHost, ARXIV_QUEUE } = await import("./arxiv.js");
const { clearCooldown, cooldownRemaining } = await import("./http.js");

const feed = (id, title) =>
  new Response(
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>http://arxiv.org/abs/${id}v1</id><title>${title}</title>
      <summary>An abstract.</summary><published>2017-06-12T17:57:34Z</published>
      <author><name>Ashish Vaswani</name></author>
    </entry></feed>`,
    { status: 200 }
  );

const datacite = (title) =>
  new Response(
    JSON.stringify({
      data: {
        attributes: {
          titles: [{ title }],
          creators: [
            { name: "Vaswani, Ashish", nameType: "Personal", givenName: "Ashish", familyName: "Vaswani" },
            { name: "Shazeer, Noam", nameType: "Personal" },
          ],
          publicationYear: 2017,
          descriptions: [
            { descriptionType: "Abstract", description: "The dominant  sequence\n models." },
            { descriptionType: "Other", description: "15 pages" },
          ],
          url: "https://arxiv.org/abs/1706.03762",
        },
      },
    }),
    { status: 200 }
  );

const tooMany = (headers = {}) => new Response("Rate exceeded.", { status: 429, headers });
const isArxivApi = (url) => url.includes("export.arxiv.org");

function fresh() {
  calls.length = 0;
  clearCooldown(ARXIV_QUEUE);
}

test("asks arXiv over https, so a lookup is one request rather than a redirect and a second", async () => {
  fresh();
  handler = () => feed("1111.00001", "A paper");
  const paper = await fetchByArxiv("1111.00001");
  assert.equal(paper.title, "A paper");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/export\.arxiv\.org\/api\/query/);
});

test("when arXiv answers 429, the paper still resolves from the record arXiv registered with DataCite", async () => {
  fresh();
  handler = (url) => (isArxivApi(url) ? tooMany() : datacite("Attention Is All You Need"));
  const paper = await fetchByArxiv("https://arxiv.org/abs/1706.03762v5");

  assert.equal(paper.title, "Attention Is All You Need");
  assert.deepEqual(paper.authors, ["Ashish Vaswani", "Noam Shazeer"]);
  assert.equal(paper.year, 2017);
  assert.equal(paper.abstract, "The dominant sequence models.");
  assert.equal(paper.arxivId, "1706.03762");
  assert.equal(paper.venue, "arXiv");
  assert.equal(paper.doi, "", "the arXiv DOI must not stand in for a published DOI");
  assert.match(calls[1], /api\.datacite\.org\/dois\/10\.48550%2Farxiv\.1706\.03762$/);
});

test("after a 429 it leaves arXiv alone for a while instead of asking again straight away", async () => {
  fresh();
  handler = (url) => (isArxivApi(url) ? tooMany() : datacite("First"));
  await fetchByArxiv("2201.00001");
  assert.ok(cooldownRemaining(ARXIV_QUEUE) > 50_000, "a 429 with no Retry-After should pause about a minute");

  calls.length = 0;
  handler = (url) => (isArxivApi(url) ? feed("2201.00002", "Should not be asked") : datacite("Second"));
  const paper = await fetchByArxiv("2201.00002");
  assert.equal(paper.title, "Second");
  assert.equal(calls.some(isArxivApi), false, "arXiv was asked again during the back-off");
});

test("uses Retry-After when arXiv sends one", async () => {
  fresh();
  handler = (url) => (isArxivApi(url) ? tooMany({ "Retry-After": "120" }) : datacite("Paper"));
  await fetchByArxiv("2201.00003");
  const remaining = cooldownRemaining(ARXIV_QUEUE);
  assert.ok(remaining > 115_000 && remaining <= 120_000, `cooldown was ${remaining}ms`);
});

test("an old-style id has no backup record, so the error says to wait rather than that the paper is missing", async () => {
  fresh();
  handler = (url) => (isArxivApi(url) ? tooMany() : datacite("never"));
  await assert.rejects(fetchByArxiv("math.GT/0309136"), (err) => {
    assert.equal(err.status, 503);
    assert.match(err.message, /limiting requests from your network/);
    assert.match(err.message, /math\.GT\/0309136/);
    assert.match(err.message, /Try again in about \d+ seconds/);
    return true;
  });
  assert.equal(calls.filter((url) => url.includes("datacite")).length, 0);
});

test("a paper arXiv says does not exist is reported missing, not looked for elsewhere", async () => {
  fresh();
  handler = (url) =>
    isArxivApi(url)
      ? new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 })
      : datacite("should not be used");
  await assert.rejects(fetchByArxiv("9912.99999"), (err) => {
    assert.match(err.message, /No arXiv record found/);
    assert.equal(err.status, 404);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("arXiv's error report for a malformed id is not taken for a paper titled 'Error'", async () => {
  fresh();
  handler = () =>
    new Response(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <id>http://arxiv.org/api/errors#incorrect_id_format_for_1234.5678</id>
        <title>Error</title><summary>incorrect id format for 1234.5678</summary>
      </entry></feed>`,
      { status: 200 }
    );
  await assert.rejects(fetchByArxiv("1234.5678"), /No arXiv record found/);
});

test("a request arXiv never answers falls back instead of hanging the lookup", async () => {
  fresh();
  handler = (url) => {
    if (isArxivApi(url)) throw new DOMException("The operation timed out.", "TimeoutError");
    return datacite("Slow day");
  };
  const paper = await fetchByArxiv("2201.00004");
  assert.equal(paper.title, "Slow day");
  assert.ok(cooldownRemaining(ARXIV_QUEUE) > 0, "a timeout should also pause arXiv briefly");
});

test("isArxivHost recognises arXiv's own hosts and nothing that merely mentions it", () => {
  assert.equal(isArxivHost("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(isArxivHost("https://export.arxiv.org/api/query"), true);
  assert.equal(isArxivHost("https://notarxiv.org/pdf/1"), false);
  assert.equal(isArxivHost("https://evil.example/arxiv.org/pdf/1"), false);
  assert.equal(isArxivHost("not a url"), false);
});
