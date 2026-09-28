import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { publicRequestPayload } from "../src/services/requestService.js";
import { plainClone } from "../src/utils/plainClone.js";

test("API payloads keep ObjectIds serializable as hex strings (structuredClone turned them into { buffer })", () => {
  const id = new mongoose.Types.ObjectId();
  const supplier = new mongoose.Types.ObjectId();
  const at = new Date("2026-09-28T10:00:00Z");
  const row = { _id: id, status: "BORRADOR", createdAt: at, lines: [{ costCenter: supplier }], attachments: [{ kind: "PDF", path: "/secret" }] };
  const copy = plainClone(row);
  assert.notEqual(copy.lines, row.lines);
  assert.equal(JSON.parse(JSON.stringify(copy))._id, String(id));
  assert.equal(JSON.parse(JSON.stringify(copy)).lines[0].costCenter, String(supplier));
  assert.ok(copy.createdAt instanceof Date && copy.createdAt.getTime() === at.getTime());
  const payload = JSON.parse(JSON.stringify(publicRequestPayload(row)));
  assert.equal(payload._id, String(id));
  assert.equal(payload.attachments[0].path, undefined);
  assert.equal(row.attachments[0].path, "/secret", "the source row is not mutated");
});
