import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeywordTotalValues,
  buildKeywordTotalTsv,
  findKeywordTotalAppendStartRow,
  isKeywordTotalHeaderRow
} from "../src/lib/sheet-write.mjs";

test("findKeywordTotalAppendStartRow appends after the last populated keyword total row", () => {
  const sheet = {
    headers: ["词根", "关键词", "国家", "搜索量", "KD", "判断"],
    rawRows: [
      ["词根", "关键词", "国家", "搜索量", "KD", "判断"],
      ["generator", "barcode generator", "美国", "301,000", "49", "继续"],
      ["generator", "yes or no generator", "美国", "12,100", "56", "拒绝"]
    ]
  };

  assert.equal(findKeywordTotalAppendStartRow(sheet), 4);
});

test("findKeywordTotalAppendStartRow ignores unrelated columns when locating append row", () => {
  const sheet = {
    headers: ["词根", "关键词", "国家", "搜索量", "KD", "判断", "状态"],
    rawRows: [
      ["词根", "关键词", "国家", "搜索量", "KD", "判断", "状态"],
      ["generator", "barcode generator", "美国", "301,000", "49", "继续", ""],
      ["", "", "", "", "", "", "manual note"]
    ]
  };

  assert.equal(findKeywordTotalAppendStartRow(sheet), 3);
});

test("buildKeywordTotalTsv writes data rows without headers by default", () => {
  assert.equal(
    buildKeywordTotalTsv([
      { 词根: "calculator", 关键词: "age calculator", 国家: "全球", 搜索量: "201,000", KD: "35", 判断: "继续" }
    ]),
    "calculator\tage calculator\t全球\t201,000\t35\t继续"
  );
});

test("buildKeywordTotalValues can include the required header row", () => {
  assert.deepEqual(
    buildKeywordTotalValues([
      { 词根: "calculator", 关键词: "age calculator", 国家: "全球", 搜索量: "201,000", KD: "35", 判断: "继续" }
    ], { includeHeader: true }),
    [
      ["词根", "关键词", "国家", "搜索量", "KD", "判断"],
      ["calculator", "age calculator", "全球", "201,000", "35", "继续"]
    ]
  );
});

test("isKeywordTotalHeaderRow validates the exact A-F header contract", () => {
  assert.equal(isKeywordTotalHeaderRow(["词根", "关键词", "国家", "搜索量", "KD", "判断"]), true);
  assert.equal(isKeywordTotalHeaderRow(["calculator", "age calculator", "全球", "201,000", "35", "继续"]), false);
});
