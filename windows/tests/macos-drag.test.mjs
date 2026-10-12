import test from "node:test";
import assert from "node:assert/strict";
import { nativeDragDrop } from "../src/core/bridge.ts";

test("native Finder drops use logical Retina coordinates and preserve file paths", () => {
  const event = { type: "drop", paths: ["/Users/test/中文 folder/report.txt"], position: { x: 400, y: 100 } };
  assert.deepEqual(nativeDragDrop(event, 2), { ...event, position: { x: 200, y: 50 } });
  assert.deepEqual(event.position, { x: 400, y: 100 }, "do not mutate the native payload");
  assert.deepEqual(nativeDragDrop(event, 1), event);
});

test("native drag enter/over and leave work without a position or valid scale", () => {
  for (const type of ["enter", "over", "drop"]) {
    const event = { type, position: { x: 300, y: 60 } };
    assert.deepEqual(nativeDragDrop(event, 2).position, { x: 150, y: 30 });
    for (const scale of [0, -1, NaN, Infinity]) assert.deepEqual(nativeDragDrop(event, scale), event);
  }
  assert.deepEqual(nativeDragDrop({ type: "leave" }, 2), { type: "leave" });
});
