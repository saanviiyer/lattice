import test from "node:test";
import assert from "node:assert/strict";
import { mockAsk } from "./ai.js";

test("mock library answers rank relevant evidence and return source ids", () => {
  const result = mockAsk("How do representations transfer?", [
    { id: "unrelated", title: "Field notes", abstract: "A study of rainfall.", takeaway: "" },
    { id: "relevant", title: "Transferable representations", abstract: "Learned representations transfer across tasks.", takeaway: "Features generalize." },
  ]);
  assert.equal(result.mockMode, true);
  assert.equal(result.sourceIds[0], "relevant");
  assert.match(result.answer, /Transferable representations/);
});

test("mock library answers fail safely when there are no sources", () => {
  const result = mockAsk("What is known?", []);
  assert.deepEqual(result.sourceIds, []);
  assert.match(result.answer, /does not contain enough material/i);
});
