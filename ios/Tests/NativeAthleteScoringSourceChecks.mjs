import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../PIXL Sports/${name}.swift`, import.meta.url), "utf8");
const projection = read("NativeEventWorkspaceSnapshot");
const commands = read("NativeEventDurableQueue");
const model = read("NativeEventTools");

test("only freshly created stat commands opt into attribution-independent scoring", () => {
  assert.match(commands, /var scoringVersion: Int\? = nil/);
  assert.match(model, /if kind == "stat" \{ command\.scoringVersion = 2 \}/);
  assert.equal((model.match(/scoringVersion = 2/g) ?? []).length, 1);
  const restore = model.slice(model.indexOf("private static func openQueue("), model.indexOf("#if DEBUG\n    init(uiTestFixture:"));
  assert.doesNotMatch(restore, /scoringVersion\s*=/);
});

test("local projection stamps actual points and preserves legacy semantics for absent versions", () => {
  assert.match(projection, /var scoreDelta: Int\? = nil/);
  assert.match(projection, /let points = command\.scoringVersion == 2 \|\| other \|\| command\.athlete != true \? stat\.points : 0/);
  assert.match(projection, /scoreDelta: points/);
  assert.match(projection, /let points = play\.scoreDelta \?\? \(play\.attribution == "athlete" && !other \? 0/);
  assert.match(projection, /game\.sport == "football" && play\.possessionSide == "opponent"/);
});

test("acknowledged actions leave the projection and uncertain requests retain their identity", () => {
  assert.match(model, /pendingQueue\.removeAll \{[\s\S]*?\$0\.attempted && \$0\.command\.kind != "prep"[\s\S]*?acknowledgedIDs\.contains\(\$0\.command\.mutationId\)/);
  assert.match(model, /displayOptimistically = false/);
  assert.match(model, /for queued in pendingQueue where queued\.displayOptimistically/);
  assert.match(projection, /where !queue\[index\]\.attempted/);
  assert.doesNotMatch(projection, /command\.scoringVersion\s*=(?!=)/);
});
