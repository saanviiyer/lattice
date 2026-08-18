import { describe, expect, it } from "vitest";
import {
  addToQueue,
  removeFromQueue,
  sanitizeQueue,
  toQueued,
} from "../src/lib/clipping.js";
import type { ClippingPayload, QueuedClipping } from "../src/lib/types.js";

const payload = (over: Partial<ClippingPayload> = {}): ClippingPayload => ({
  url: "https://example.com",
  title: "T",
  excerpt: "",
  note: "",
  collection: "",
  savedAt: "2026-08-17T12:00:00.000Z",
  ...over,
});

const queued = (localId: string, over: Partial<ClippingPayload> = {}): QueuedClipping =>
  toQueued(payload(over), localId);

describe("offline queue", () => {
  it("appends clippings in order", () => {
    let q: QueuedClipping[] = [];
    q = addToQueue(q, queued("a"));
    q = addToQueue(q, queued("b"));
    expect(q.map((c) => c.localId)).toEqual(["a", "b"]);
  });

  it("is idempotent: re-adding the same localId replaces, not duplicates", () => {
    let q: QueuedClipping[] = [];
    q = addToQueue(q, queued("a", { title: "first" }));
    q = addToQueue(q, queued("a", { title: "second" }));
    expect(q).toHaveLength(1);
    expect(q[0].title).toBe("second");
  });

  it("removes by localId", () => {
    let q = [queued("a"), queued("b"), queued("c")];
    q = removeFromQueue(q, "b");
    expect(q.map((c) => c.localId)).toEqual(["a", "c"]);
  });

  it("removing a missing id is a no-op", () => {
    const q = [queued("a")];
    expect(removeFromQueue(q, "zzz")).toHaveLength(1);
  });
});

describe("sanitizeQueue", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeQueue(null)).toEqual([]);
    expect(sanitizeQueue({})).toEqual([]);
    expect(sanitizeQueue("nope")).toEqual([]);
  });

  it("drops invalid entries and keeps valid ones", () => {
    const raw = [
      queued("good"),
      { url: "", title: "no url", localId: "x" }, // invalid: no url
      { url: "https://ok.io", title: "", localId: "y" }, // invalid: no title
      { nonsense: true },
      null,
    ];
    const out = sanitizeQueue(raw);
    expect(out).toHaveLength(1);
    expect(out[0].localId).toBe("good");
  });

  it("backfills a missing localId", () => {
    const out = sanitizeQueue([{ url: "https://ok.io", title: "keep" }]);
    expect(out).toHaveLength(1);
    expect(out[0].localId).toBeTruthy();
  });
});
