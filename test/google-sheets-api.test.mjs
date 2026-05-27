import assert from "node:assert/strict";
import test from "node:test";
import { buildRejectedKeywordCellFormatRequests } from "../src/lib/google-sheets-api.mjs";

test("buildRejectedKeywordCellFormatRequests targets keyword cells for rejected rows", () => {
  const requests = buildRejectedKeywordCellFormatRequests({
    sheetId: "999267438",
    startRow: 10,
    rows: [
      { 关键词: "age calculator", 判断: "继续" },
      { 关键词: "ai porn generator", 判断: "拒绝" },
      { 关键词: "binary converter", 判断: "继续" },
      { 关键词: "generator installation", 判断: "拒绝" }
    ]
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.repeatCell.range), [
    {
      sheetId: 999267438,
      startRowIndex: 10,
      endRowIndex: 11,
      startColumnIndex: 1,
      endColumnIndex: 2
    },
    {
      sheetId: 999267438,
      startRowIndex: 12,
      endRowIndex: 13,
      startColumnIndex: 1,
      endColumnIndex: 2
    }
  ]);
  assert.deepEqual(requests[0].repeatCell.cell.userEnteredFormat.backgroundColor, {
    red: 1,
    green: 0,
    blue: 0
  });
});
