import assert from "node:assert/strict";
import test from "node:test";
import { parseSheetGidsFromHtml } from "../src/lib/google-sheet.mjs";

test("parseSheetGidsFromHtml extracts sheet names and gids from bootstrap chunks", () => {
  const html = String.raw`topsnapshot":[[21350203,"[0,0,\"17708679\",[{\"1\":[[0,0,\"工具账号密码\"]]}],1000,26]"],[21350203,"[1,0,\"0\",[{\"1\":[[0,0,\"词根拓展\"]]}],1000,27]"],[21350203,"[2,0,\"999267438\",[{\"1\":[[0,0,\"关键词总表\"]]}],1000,25]"]]`;

  assert.deepEqual(parseSheetGidsFromHtml(html), {
    工具账号密码: "17708679",
    词根拓展: "0",
    关键词总表: "999267438"
  });
});
