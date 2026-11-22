import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, initials, isUuid, safeNextPath } from "../src/lib/utils.ts";

test("safeNextPath only allows same-origin relative paths", () => {
  assert.equal(safeNextPath("/projects/1"), "/projects/1");
  assert.equal(safeNextPath("https://evil.com"), "/dashboard");
  assert.equal(safeNextPath("//evil.com"), "/dashboard");
  assert.equal(safeNextPath("/\\evil.com"), "/dashboard");
  assert.equal(safeNextPath(null), "/dashboard");
  assert.equal(safeNextPath("relative", "/x"), "/x");
});

test("isUuid validates UUIDs", () => {
  assert.ok(isUuid("8b6f1f9e-4a1b-4c3d-9e2f-1a2b3c4d5e6f"));
  assert.ok(!isUuid("not-a-uuid"));
  assert.ok(!isUuid("8b6f1f9e-4a1b-4c3d-9e2f-1a2b3c4d5e6f' or 1=1"));
  assert.ok(!isUuid(42));
});

test("initials", () => {
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("ada.lovelace@x.com"), "AL");
  assert.equal(initials("ada@x.com"), "AD");
  assert.equal(initials(null), "?");
});

test("formatDuration", () => {
  assert.equal(formatDuration(42), "42s");
  assert.equal(formatDuration(65), "1m 05s");
  assert.equal(formatDuration(-3), "0s");
});
