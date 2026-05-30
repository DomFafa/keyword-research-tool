import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STATUS_COLUMN,
  normalizeDecision
} from "../src/lib/openai-keyword-agent.mjs";

test("openai keyword agent writes rationale and status for excluded rows", () => {
  const result = normalizeDecision({
    rowNumber: 21,
    intent: "其他",
    firstJudgement: "排除",
    difficulty: "",
    secondJudgement: "",
    monetization: "",
    thirdJudgement: "",
    recommendation: "",
    rationale: "真实意图是实体发电机/商品词，不是在线工具需求",
    rating: ""
  });

  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.equal(result.values["判断依据"], "真实意图是实体发电机/商品词，不是在线工具需求");
  assert.equal(result.values[AGENT_STATUS_COLUMN], "排除");
  assert.equal(result.values["难度"], undefined);
});

test("openai keyword agent writes done status for non-excluded rows", () => {
  const result = normalizeDecision({
    rowNumber: 25,
    intent: "工具站",
    firstJudgement: "继续",
    difficulty: "轻：纯前端可做",
    secondJudgement: "推荐",
    monetization: "轻saas",
    thirdJudgement: "推荐",
    recommendation: "做免费入口+导出付费，品牌词需避险",
    rationale: "可轻量实现，有导出订阅理由，品牌词风险",
    rating: "A"
  });

  assert.equal(result.values["第一次判断"], "继续");
  assert.equal(result.values[AGENT_STATUS_COLUMN], "完成");
});
