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

test("keyword agent keeps tool keywords when customer intent is tool site", () => {
  const result = evaluateKeywordAgentRow(row("invoice generator"), toolRule);

  assert.equal(result.values["意图"], "工具站");
  assert.equal(result.values["第一次判断"], "继续");
});

test("keyword agent rejects tool keywords when customer intent is B2B showcase", () => {
  const result = evaluateKeywordAgentRow(row("invoice generator"), {
    ...toolRule,
    "意图": "B端展示站"
  });

  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.match(result.values["判断依据"], /工具站|不匹配客户目标B端展示站/);
  assert.equal(result.values["agent状态"], "排除");
});

test("keyword agent keeps B2B supplier keywords for B2B showcase intent", () => {
  for (const keyword of ["gaming microphone manufacturer", "fpv drone supplier"]) {
    const result = evaluateKeywordAgentRow(row(keyword), {
      ...toolRule,
      "意图": "B端展示站",
      "变现渠道1": "其他",
      "变现渠道2": "",
      "能力1": "B端展示站",
      "能力2": "询盘页"
    });

    assert.equal(result.values["意图"], "B端展示站");
    assert.equal(result.values["第一次判断"], "继续");
    assert.match(`${result.values["判断依据"]} ${result.values["建议"]}`, /B端|供应商|询盘|线索|企业采购|RFQ/);
    assert.equal(result.values["agent状态"], "完成");
  }
});

test("keyword agent rejects B2B supplier keywords for tool site intent", () => {
  const result = evaluateKeywordAgentRow(row("memory chip distributor"), toolRule);

  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.match(result.values["判断依据"], /B端展示站|供应商|不匹配客户目标工具站/);
});

test("keyword agent can recommend B2B showcase monetization when other channel is allowed", () => {
  const result = evaluateKeywordAgentRow(row("gaming microphone manufacturer"), {
    "意图": "B端展示站",
    "变现渠道1": "其他",
    "变现渠道2": "",
    "能力1": "B端展示站",
    "能力2": "询盘页"
  });

  assert.equal(result.values["变现渠道"], "其他");
  assert.equal(result.values["第二次判断"], "推荐");
  assert.equal(result.values["第三次判断"], "推荐");
  assert.equal(result.values["评级"], "A");
});

test("keyword agent rejects B2B showcase monetization when other channel is not allowed", () => {
  const result = evaluateKeywordAgentRow(row("gaming microphone manufacturer"), {
    "意图": "B端展示站",
    "变现渠道1": "广告",
    "变现渠道2": "",
    "能力1": "B端展示站",
    "能力2": ""
  });

  assert.equal(result.values["变现渠道"], "其他");
  assert.equal(result.values["第三次判断"], "不推荐");
  assert.match(result.values["判断依据"], /不匹配客户变现渠道|询盘|线索变现不匹配/);
});

test("keyword agent stops after first judgement for AI-replaced simple utilities", () => {
  const result = evaluateKeywordAgentRow(row("percentage calculator"), toolRule);

  assert.equal(result.stopAfterFirstJudgement, true);
  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.match(result.values["判断依据"], /可被AI直接满足/);
  assert.equal(result.values["agent状态"], "排除");
});

test("keyword agent excludes adult and high-risk terms", () => {
  assert.equal(evaluateKeywordAgentRow(row("ai porn generator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("casino odds calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("peptide calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("tax calculator"), toolRule).values["第一次判断"], "排除");
  assert.equal(evaluateKeywordAgentRow(row("investment calculator"), toolRule).values["第一次判断"], "排除");
});

test("keyword agent keeps financial education calculators with risk warnings", () => {
  for (const keyword of [
    "401k calculator",
    "retirement calculator",
    "mortgage calculator",
    "loan calculator",
    "cd calculator",
    "roth ira calculator",
    "paycheck calculator",
    "salary paycheck calculator"
  ]) {
    const result = evaluateKeywordAgentRow(row(keyword), {
      ...toolRule,
      "变现渠道1": "广告",
      "变现渠道2": ""
    });

    assert.equal(result.values["第一次判断"], "继续");
    assert.equal(result.values["agent状态"], "完成");
    assert.match(result.values["判断依据"], /教育|YMYL|财务建议|免责声明/);
    assert.match(result.values["建议"], /教育|估算|财务建议|免责声明/);
  }
});

test("keyword agent keeps health education calculators with risk warnings", () => {
  for (const keyword of ["due date calculator", "pregnancy calculator", "pregnancy due date calculator", "ivf due date calculator", "recipe calorie calculator"]) {
    const result = evaluateKeywordAgentRow(row(keyword), toolRule);

    assert.equal(result.values["意图"], "工具站");
    assert.equal(result.values["第一次判断"], "继续");
    assert.equal(result.values["agent状态"], "完成");
    assert.match(`${result.values["判断依据"]} ${result.values["建议"]}`, /健康教育|YMYL|免责声明|医疗建议/);
  }
});

test("keyword agent still excludes tax and investment calculators", () => {
  const tax = evaluateKeywordAgentRow(row("tax calculator"), toolRule);
  assert.equal(tax.values["意图"], "其他");
  assert.equal(tax.values["第一次判断"], "排除");
  assert.notEqual(tax.values["判断依据"], "");
  assert.equal(tax.values["agent状态"], "排除");

  const crypto = evaluateKeywordAgentRow(row("crypto calculator"), toolRule);
  assert.equal(crypto.values["第一次判断"], "排除");
  assert.match(crypto.values["判断依据"], /金融投资|高风险|投资建议/);

  const investment = evaluateKeywordAgentRow(row("investment calculator"), toolRule);
  assert.equal(investment.values["第一次判断"], "排除");
  assert.match(investment.values["判断依据"], /金融投资|高风险|投资建议/);
});

test("keyword agent rejects physical generator product keywords", () => {
  for (const keyword of ["honda generator", "solar generator", "portable generator"]) {
    const result = evaluateKeywordAgentRow(row(keyword), toolRule);
    assert.equal(result.values["意图"], "其他");
    assert.equal(result.values["第一次判断"], "排除");
    assert.notEqual(result.values["判断依据"], "");
    assert.equal(result.values["agent状态"], "排除");
  }
});

test("keyword agent does not reject brand terms but warns in recommendation", () => {
  for (const keyword of [
    "canva qr code generator",
    "starbucks calorie calculator",
    "smartasset paycheck calculator",
    "dave ramsey mortgage calculator",
    "perchance ai story generator"
  ]) {
    const result = evaluateKeywordAgentRow(row(keyword), toolRule);

    assert.equal(result.values["第一次判断"], "继续");
    assert.match(`${result.values["建议"]} ${result.values["判断依据"]}`, /品牌|商标|风险/);
    assert.equal(result.values["agent状态"], "完成");
  }
});

test("keyword agent marks heavy AI tools as not matching light edge capability", () => {
  for (const keyword of ["runway ai video generator", "suno ai music generator", "upc generator", "map calculator", "online video editor"]) {
    const result = evaluateKeywordAgentRow(row(keyword), toolRule);

    assert.equal(result.values["评级"] === "A", false);
    assert.equal(result.values["第二次判断"], "不推荐");
  }
});

test("keyword agent rejects recommendation content intent for video editors", () => {
  const result = evaluateKeywordAgentRow(row("best free video editor"), toolRule);

  assert.equal(result.values["意图"], "其他");
  assert.equal(result.values["第一次判断"], "排除");
  assert.match(result.values["判断依据"], /推荐|对比|内容意图/);
  assert.equal(result.values["agent状态"], "排除");
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
