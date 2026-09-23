import test from "node:test";
import assert from "node:assert/strict";
import { isFetchableUrl, pdfCandidates } from "./openAccess.js";

test("isFetchableUrl allows ordinary public https and http", () => {
  assert.equal(isFetchableUrl("https://arxiv.org/pdf/2401.01234"), true);
  assert.equal(isFetchableUrl("http://journals.plos.org/article.pdf"), true);
});

test("isFetchableUrl refuses schemes that are not the web", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/a.pdf", "not a url", ""]) {
    assert.equal(isFetchableUrl(url), false, url);
  }
});

test("isFetchableUrl refuses addresses inside the server's own network", () => {
  const blocked = [
    "http://localhost:3001/api/health",
    "http://127.0.0.1/secret",
    "http://10.0.0.5/internal.pdf",
    "http://192.168.1.20/internal.pdf",
    "http://172.16.4.4/internal.pdf",
    // The cloud metadata endpoint is the one that actually matters.
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://[::1]/local",
  ];
  for (const url of blocked) assert.equal(isFetchableUrl(url), false, url);
});

test("an arXiv id resolves to its PDF without any network lookup", async () => {
  const candidates = await pdfCandidates({ arxivId: "2401.01234" });
  assert.deepEqual(candidates, [{ url: "https://arxiv.org/pdf/2401.01234", via: "arxiv" }]);
});

test("an arXiv URL and a versioned id reach the same PDF", async () => {
  const fromUrl = await pdfCandidates({ arxivId: "https://arxiv.org/abs/2401.01234v3" });
  assert.equal(fromUrl[0].url, "https://arxiv.org/pdf/2401.01234");
});

test("an arXiv-minted DOI is recognised without asking an index", async () => {
  const candidates = await pdfCandidates({ doi: "10.48550/arXiv.2401.01234" });
  assert.equal(candidates[0].url, "https://arxiv.org/pdf/2401.01234");
  assert.equal(candidates[0].via, "arxiv");
});

test("a record with nothing to go on yields no candidates", async () => {
  assert.deepEqual(await pdfCandidates({}), []);
  // A landing page is not a file, so it is not offered as one.
  assert.deepEqual(await pdfCandidates({ url: "https://example.com/article" }), []);
});

test("a direct PDF URL on the record is offered", async () => {
  const candidates = await pdfCandidates({ url: "https://example.com/paper.pdf" });
  assert.deepEqual(candidates, [{ url: "https://example.com/paper.pdf", via: "record" }]);
});
