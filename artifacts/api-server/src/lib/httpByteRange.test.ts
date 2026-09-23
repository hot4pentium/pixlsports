import assert from "node:assert/strict";
import test from "node:test";
import { parseHttpByteRange } from "./httpByteRange";

test("video byte ranges support initial loads, seeks, and suffix requests", () => {
  assert.deepEqual(parseHttpByteRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseHttpByteRange("bytes=25-", 100), { start: 25, end: 99 });
  assert.deepEqual(parseHttpByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseHttpByteRange("bytes=95-120", 100), { start: 95, end: 99 });
});

test("large open-ended video requests are delivered in bounded partial responses", () => {
  const size = 35 * 1024 * 1024;
  const chunk = 4 * 1024 * 1024;
  assert.deepEqual(parseHttpByteRange("bytes=0-", size, chunk), { start: 0, end: chunk - 1 });
  assert.deepEqual(parseHttpByteRange(`bytes=${chunk}-`, size, chunk), { start: chunk, end: 2 * chunk - 1 });
  assert.deepEqual(parseHttpByteRange("bytes=0-1", size, chunk), { start: 0, end: 1 });
  assert.deepEqual(parseHttpByteRange(`bytes=${size - 5}-`, size, chunk), { start: size - 5, end: size - 1 });
  assert.deepEqual(parseHttpByteRange("bytes=0-9999999", size, chunk), { start: 0, end: chunk - 1 });
});

test("video byte ranges reject invalid and unsatisfiable requests", () => {
  for (const header of ["bytes=100-", "bytes=30-20", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "items=0-1", "bytes=999999999999999999999-"]) {
    assert.equal(parseHttpByteRange(header, 100), null, header);
  }
  assert.equal(parseHttpByteRange("bytes=0-1", 0), null);
});