import assert from "node:assert/strict";
import test from "node:test";
import { evaluateKeywordAgentRow } from "../src/lib/keyword-agent-rules.mjs";

const toolRule = {
  "意图": "工具站",
  "变现渠道1": "广告",
  "变现渠道2": "轻saas",
  "能力1": "批量建轻量工具站",
  "能力2": "轻量简单SaaS"
};

function row(keyword) {
  return {
    record: {
      "关键词": keyword
    }
  };
}

test("keyword agent keeps dynamic customer intent from task rule", () => {
  const result = evaluateKeywordAgentRow(row("invoice generator"), {
    ...toolRule,
    "意图": "B端展示站"
  });

  assert.equal(result.values["意图"], "B端展示站");
  assert.equal(result.values["第一次判断"], "继续");
  assert.equal(result.values["变现渠道"], "轻saas");
  assert.equal(result.values["评级"], "A");
});

test("keyword agent stops after first judgement for AI-replaced simple utilities", () => {
  const result = evaluateKeywordAgentRow(row("percentage calculator"), toolRule);

  assert.equal(result.stopAfterFirstJudgement, true);
  assert.deepEqual(result.values, {
    "意图": "其他",
    "第一次判断": "排除"
  });
});

test("keyword agent excludes adult and high-risk terms", () => {
  assert.equal(evaluateKeywordAgentRow(row("ai porn generator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("casino odds calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("peptide calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("tax calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("investment calculator"), toolRule).values["第一次判断"], "排除");
});

test("keyword agent rejects physical generator product keywords", () => {
  assert.deepEqual(evaluateKeywordAgentRow(row("honda generator"), toolRule).values, {
    "意图": "其他",
    "第一次判断": "排除"
  });
  assert.deepEqual(evaluateKeywordAgentRow(row("solar generator"), toolRule).values, {
    "意图": "其他",
    "第一次判断": "排除"
  });
  assert.deepEqual(evaluateKeywordAgentRow(row("portable generator"), toolRule).values, {
    "意图": "其他",
    "第一次判断": "排除"
  });
});

test("keyword agent does not reject brand terms but warns in recommendation", () => {
  const result = evaluateKeywordAgentRow(row("canva qr code generator"), toolRule);

  assert.equal(result.values["第一次判断"], "继续");
  assert.match(result.values["建议"], /品牌/);
  assert.match(result.values["判断依据"], /品牌词风险/);
});

test("keyword agent marks heavy AI tools as not matching light edge capability", () => {
  const result = evaluateKeywordAgentRow(row("runway ai video generator"), toolRule);

  assert.equal(result.values["难度"].startsWith("重："), true);
  assert.equal(result.values["第二次判断"], "不推荐");
  assert.equal(result.values["评级"], "C");
});

test("keyword agent rejects monetization mismatch", () => {
  const result = evaluateKeywordAgentRow(row("random word generator"), {
    ...toolRule,
    "变现渠道1": "轻saas",
    "变现渠道2": ""
  });

  assert.equal(result.values["变现渠道"], "广告");
  assert.equal(result.values["第三次判断"], "不推荐");
  assert.equal(result.values["评级"], "B");
});
