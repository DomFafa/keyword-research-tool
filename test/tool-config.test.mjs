import assert from "node:assert/strict";
import test from "node:test";
import { parseSheetValues, pickKeywordTask } from "../src/lib/tool-config.mjs";

test("parseSheetValues validates required headers and maps rows", () => {
  const sheet = parseSheetValues([
    ["semrush账号", "semrush密码", "运行浏览器账号"],
    ["imomo", "secret", "vc.ddom@gmail.com"]
  ], ["semrush账号", "semrush密码"]);

  assert.deepEqual(sheet.headers, ["semrush账号", "semrush密码", "运行浏览器账号"]);
  assert.deepEqual(sheet.rows, [
    {
      semrush账号: "imomo",
      semrush密码: "secret",
      运行浏览器账号: "vc.ddom@gmail.com"
    }
  ]);
});

test("parseSheetValues fails on missing required headers", () => {
  assert.throws(
    () => parseSheetValues([["semrush账号"], ["imomo"]], ["semrush账号", "semrush密码"]),
    /子表缺少表头: semrush密码/
  );
});

test("pickKeywordTask uses spreadsheet row numbers", () => {
  const task = pickKeywordTask([
    { 词根: "ignored", 关键词: "" },
    {
      词根: "generator",
      关键词: "",
      匹配类型: "完全匹配",
      匹配国家: "美国",
      "搜索量范围（小）": "100",
      "搜索量范围（大）": "1000",
      "KD范围（小）": "0",
      "KD范围（大）": "30"
    }
  ], 3);

  assert.equal(task.rowNumber, 3);
  assert.equal(task.query, "generator");
  assert.equal(task.mode, "root");
  assert.equal(task.matchCountry, "美国");
});
