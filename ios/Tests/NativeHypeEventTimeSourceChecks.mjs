import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../PIXL Sports/${file}`, import.meta.url), "utf8");

test("owner and public HYPE Cards use 12-hour event time and Complete calendar labels", () => {
  const view = read("SupporterHypeCardView.swift");
  assert.match(view, /nativeEventTimeDisplay\(event\.time\)/);
  assert.match(view, /event\.status == "final" \? "COMPLETE"/);
});

test("native time rendering uses an explicit AM/PM locale without viewer-zone conversion", () => {
  const api = read("SupporterHomeAPI.swift");
  const helper = api.slice(api.indexOf("func nativeEventTimeDisplay"), api.indexOf("struct NativeHypeEvent"));
  assert.match(helper, /Locale\(identifier: "en_US_POSIX"\)/);
  assert.match(helper, /TimeZone\(secondsFromGMT: 0\)/);
  assert.match(helper, /formatter\.dateFormat = "h:mm a"/);
  assert.match(api, /time\.isEmpty \? "Time to be announced" : nativeEventTimeDisplay\(time\)/);
  assert.match(read("ContentView.swift"), /nativeEventTimeDisplay\(change\.draft\.time\)/);
});
