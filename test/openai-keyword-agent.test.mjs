import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STATUS_COLUMN,
  KEYWORD_AGENT_SYSTEM_PROMPT,
  buildPromptPayload,
  normalizeDecision,
  validateLLMOutput
} from "../src/lib/openai-keyword-agent.mjs";

test("keyword agent system prompt documents core judgement rules", () => {
  for (const expected of [
    "不要只看词尾",
    "customerConfig.desiredIntent",
    "invoice generator + B端展示站",
    "gaming microphone manufacturer",
    "401k calculator",
    "tax calculator",
    "stock",
    "crypto",
    "品牌词不自动排除",
    "B端展示站",
    "询盘/线索",
    "firstJudgement=排除 时 rating 必须为空"
  ]) {
    assert.match(KEYWORD_AGENT_SYSTEM_PROMPT, new RegExp(expected.replace(/[()+]/g, "\\$&")));
  }
});

test("keyword agent prompt payload documents prefiltered rows and semantic rules", () => {
  const payload = buildPromptPayload([
    {
      rowNumber: 2,
      keyword: "gaming microphone manufacturer",
      keywordRecord: { "词根": "manufacturer", "关键词": "gaming microphone manufacturer" },
      rule: {
        "词根": "manufacturer",
        "意图": "B端展示站",
        "变现渠道1": "其他",
        "能力1": "B端展示站"
      }
    }
  ]);
  const rulesText = JSON.stringify(payload.rules);

  assert.match(rulesText, /Rows are already filtered|bing二次判断=继续/);
  assert.match(rulesText, /Actual intent must match customerConfig\.desiredIntent|Do not hard-map desiredIntent/);
  assert.match(rulesText, /401k calculator|financial education|education-only estimators/);
  assert.match(rulesText, /B端展示站|RFQ|supplier/);
  assert.equal(payload.rows[0].customerConfig.desiredIntent, "B端展示站");
  assert.deepEqual(payload.rows[0].customerConfig.allowedMonetizationChannels, ["其他"]);
});

test("keyword agent prompt payload includes optional research context", () => {
  const payload = buildPromptPayload([
    {
      rowNumber: 2,
      keyword: "canva qr code generator",
      keywordRecord: { "词根": "generator", "关键词": "canva qr code generator" },
      rule: {
        "词根": "generator",
        "意图": "工具站",
        "变现渠道1": "广告"
      },
      research: {
        needed: true,
        reasons: ["brand_boundary"],
        confidence: "high",
        summary: "Official Canva tool dominates the SERP; brand risk is high.",
        findings: [
          {
            title: "Canva QR Code Generator",
            url: "https://www.canva.com/",
            snippet: "Official Canva tool"
          }
        ]
      }
    }
  ]);
  const rulesText = JSON.stringify(payload.rules);

  assert.equal(payload.rows[0].research.needed, true);
  assert.equal(payload.rows[0].research.topFindings.length, 1);
  assert.match(rulesText, /read-only auxiliary context|do not invent external facts|official brand-tool/);
});

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

test("validator allows excluded rows with empty downstream fields and writes rationale/status", () => {
  const result = validateLLMOutput(
    { rowNumber: 31 },
    {
      rowNumber: 31,
      intent: "其他",
      firstJudgement: "排除",
      difficulty: "重：不应写入",
      secondJudgement: "推荐",
      monetization: "广告",
      thirdJudgement: "推荐",
      recommendation: "不应写入",
      rationale: "",
      rating: "A"
    },
    { desiredIntent: "工具站", allowedMonetizationChannels: ["广告"] }
  );

  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.equal(result.values["难度"], undefined);
  assert.equal(result.values["第二次判断"], undefined);
  assert.equal(result.values[AGENT_STATUS_COLUMN], "排除");
  assert.ok(result.values["判断依据"].length >= 20);
  assert.ok(result.values["判断依据"].length <= 80);
  assert.ok(result.warnings.some((item) => item.field === "判断依据"));
});

test("validator normalizes continued rows into legal sheet fields", () => {
  const result = validateLLMOutput(
    { rowNumber: 32 },
    {
      rowNumber: 32,
      intent: "乱填",
      firstJudgement: "继续",
      difficulty: "easy",
      secondJudgement: "maybe",
      monetization: "bad-channel",
      thirdJudgement: "yes",
      recommendation: "",
      rationale: "",
      rating: "Z"
    },
    { desiredIntent: "工具站", allowedMonetizationChannels: ["广告", "轻saas"] }
  );

  assert.equal(result.values["意图"], "工具站");
  assert.equal(result.values["第一次判断"], "继续");
  assert.match(result.values["难度"], /^[轻中重]：/);
  assert.equal(["推荐", "不推荐"].includes(result.values["第二次判断"]), true);
  assert.equal(["广告", "轻saas", "其他"].includes(result.values["变现渠道"]), true);
  assert.equal(["推荐", "不推荐"].includes(result.values["第三次判断"]), true);
  assert.equal(["A", "B", "C"].includes(result.values["评级"]), true);
  assert.equal(result.values[AGENT_STATUS_COLUMN], "完成");
  assert.ok(result.values["建议"]);
  assert.ok(result.values["判断依据"]);
  assert.ok(result.warnings.length > 0);
});

test("validator recomputes third judgement when monetization is not allowed", () => {
  const result = validateLLMOutput(
    { rowNumber: 33 },
    {
      rowNumber: 33,
      intent: "工具站",
      firstJudgement: "继续",
      difficulty: "轻：Workers可做",
      secondJudgement: "推荐",
      monetization: "轻saas",
      thirdJudgement: "推荐",
      recommendation: "做免费入口+导出付费",
      rationale: "需求明确且可轻量实现，但客户不允许该变现渠道",
      rating: "A"
    },
    { desiredIntent: "工具站", allowedMonetizationChannels: ["广告"] }
  );

  assert.equal(result.values["变现渠道"], "轻saas");
  assert.equal(result.values["第三次判断"], "不推荐");
  assert.equal(result.values["评级"], "B");
  assert.ok(result.warnings.some((item) => item.field === "第三次判断"));
});

test("validator recomputes rating from second and third judgement", () => {
  const cases = [
    { second: "推荐", third: "推荐", expected: "A" },
    { second: "不推荐", third: "不推荐", expected: "C" },
    { second: "推荐", third: "不推荐", expected: "B" }
  ];

  for (const item of cases) {
    const result = validateLLMOutput(
      { rowNumber: 40 },
      {
        rowNumber: 40,
        intent: "工具站",
        firstJudgement: "继续",
        difficulty: "轻：Workers可做",
        secondJudgement: item.second,
        monetization: "广告",
        thirdJudgement: item.third,
        recommendation: "做免费轻工具页承接流量",
        rationale: "需求明确且实现轻量，适合当前客户能力和变现方式",
        rating: "A"
      },
      { desiredIntent: "工具站", allowedMonetizationChannels: ["广告"] }
    );

    assert.equal(result.values["评级"], item.expected);
  }
});
