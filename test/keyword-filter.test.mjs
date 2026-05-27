import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateKeywordForToolSite,
  filterKeywordRowsForToolSites
} from "../src/lib/keyword-filter.mjs";

const task = { rootKeyword: "calculator", query: "calculator" };

test("keyword machine filter keeps tool-site domain-shaped keywords", () => {
  assert.equal(evaluateKeywordForToolSite({ 关键词: "age calculator" }, task).accepted, true);
  assert.equal(evaluateKeywordForToolSite({ 关键词: "age calculator online" }, task).accepted, true);
  assert.equal(evaluateKeywordForToolSite({ 关键词: "age calculator pro" }, task).accepted, true);
  assert.equal(evaluateKeywordForToolSite({ 关键词: "binary converter" }, task).accepted, true);
});

test("keyword machine filter rejects obvious non-tool-site keywords", () => {
  assert.deepEqual(evaluateKeywordForToolSite({ 关键词: "calculator" }, task), {
    accepted: false,
    reason: "exact_root_only"
  });
  assert.equal(evaluateKeywordForToolSite({ 关键词: "ai porn generator" }, { rootKeyword: "generator" }).accepted, false);
  assert.equal(evaluateKeywordForToolSite({ 关键词: "generator installation near me" }, { rootKeyword: "generator" }).accepted, false);
  assert.deepEqual(evaluateKeywordForToolSite({ 关键词: "ai image generator from image" }, { rootKeyword: "generator" }), {
    accepted: false,
    reason: "unsupported_suffix:image"
  });
  assert.deepEqual(evaluateKeywordForToolSite({ 关键词: "random number generator 1-100" }, { rootKeyword: "generator" }), {
    accepted: false,
    reason: "unsupported_suffix:100"
  });
});

test("filterKeywordRowsForToolSites annotates accepted and rejected rows", () => {
  const result = filterKeywordRowsForToolSites([
    { 词根: "calculator", 关键词: "age calculator", 搜索量: "1000", KD: "30" },
    { 词根: "calculator", 关键词: "calculator", 搜索量: "1000", KD: "30" }
  ], task);

  assert.equal(result.summary.rawRows, 2);
  assert.equal(result.summary.acceptedRows, 1);
  assert.equal(result.summary.rejectedRows, 1);
  assert.equal(result.accepted[0].判断, "继续");
  assert.equal(result.rejected[0].判断, "拒绝");
  assert.equal(result.accepted[0].机器筛选状态, "通过");
  assert.equal(result.rejected[0].机器筛选原因, "exact_root_only");
  assert.deepEqual(result.rows.map((row) => row.关键词), ["age calculator", "calculator"]);
});

test("filterKeywordRowsForToolSites treats all rows as continue when disabled", () => {
  const result = filterKeywordRowsForToolSites([
    { 词根: "calculator", 关键词: "calculator", 搜索量: "1000", KD: "30" },
    { 词根: "calculator", 关键词: "calculator installation near me", 搜索量: "1000", KD: "30" }
  ], { ...task, machineFilter: "否" });

  assert.equal(result.summary.enabled, false);
  assert.equal(result.summary.acceptedRows, 2);
  assert.equal(result.summary.rejectedRows, 0);
  assert.deepEqual(result.accepted.map((row) => row.判断), ["继续", "继续"]);
  assert.deepEqual(result.accepted.map((row) => row.机器筛选原因), [
    "machine_filter_disabled",
    "machine_filter_disabled"
  ]);
});
