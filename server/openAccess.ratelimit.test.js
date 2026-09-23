// Open-access PDF fetching when arXiv is rate limiting. Kept apart from
// openAccess.test.js because these tests stub the network and those do not need to.
import test from "node:test";
import assert from "node:assert/strict";

process.env.LATTICE_ARXIV_INTERVAL_MS = "0";

let handler = () => {
  throw new Error("no handler installed");
};
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return handler(String(url));
};

const { fetchOpenAccessPdf } = await import("./openAccess.js");
const { ARXIV_QUEUE } = await import("./arxiv.js");
const { clearCooldown, coolDown, cooldownRemaining } = await import("./http.js");

const pdf = () =>
  new Response(Buffer.from("%PDF-1.4\n%fake\n"), {
    status: 200,
    headers: { "Content-Type": "application/pdf" },
  });

function fresh() {
  calls.length = 0;
  clearCooldown(ARXIV_QUEUE);
}

test("a 429 on an arXiv PDF is reported as a rate limit, and not remembered as 'no PDF exists'", async () => {
  fresh();
  handler = () => new Response("Rate exceeded.", { status: 429 });
  await assert.rejects(fetchOpenAccessPdf({ arxivId: "2401.11111" }), (err) => {
    assert.equal(err.status, 503);
    assert.match(err.message, /limiting requests from your network/);
    assert.doesNotMatch(err.message, /paywall/);
    return true;
  });
  assert.ok(cooldownRemaining(ARXIV_QUEUE) > 0, "a 429 on a PDF should start the back-off too");

  // Once arXiv recovers, the same paper has to be fetchable: the failure was not cached.
  clearCooldown(ARXIV_QUEUE);
  handler = () => pdf();
  const found = await fetchOpenAccessPdf({ arxivId: "2401.11111" });
  assert.equal(found.via, "arxiv");
  assert.equal(found.bytes.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("while arXiv is backing off, its PDF is not requested at all", async () => {
  fresh();
  coolDown(ARXIV_QUEUE, 60_000);
  handler = () => pdf();
  await assert.rejects(fetchOpenAccessPdf({ arxivId: "2401.22222" }), /limiting requests/);
  assert.equal(calls.length, 0);
});

test("a PDF hosted somewhere other than arXiv is still fetched during arXiv's back-off", async () => {
  fresh();
  coolDown(ARXIV_QUEUE, 60_000);
  handler = (url) => (url.includes("arxiv.org") ? new Response("no", { status: 500 }) : pdf());
  const found = await fetchOpenAccessPdf({ url: "https://journals.example.org/paper.pdf" });
  assert.equal(found.via, "record");
  assert.equal(calls.some((url) => url.includes("arxiv.org")), false);
});

test("a PDF host that times out is not remembered as a paywall", async () => {
  fresh();
  handler = () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  await assert.rejects(
    fetchOpenAccessPdf({ url: "https://slow.example.org/a.pdf" }),
    /did not respond in time/
  );
  handler = () => pdf();
  const found = await fetchOpenAccessPdf({ url: "https://slow.example.org/a.pdf" });
  assert.equal(found.via, "record");
});
