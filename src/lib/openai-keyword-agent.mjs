import { AGENT_STATUS_COLUMN } from "./keyword-agent-rules.mjs";

const DEFAULT_MODEL = "gpt-5.4-mini";
export { AGENT_STATUS_COLUMN };

const VALID_MONETIZATION_CHANNELS = ["广告", "轻saas", "其他"];
const VALID_JUDGEMENTS = ["推荐", "不推荐"];
const VALID_RATINGS = ["A", "B", "C"];
const DEFAULT_EXCLUDED_RATIONALE = "LLM判定为排除，原始判断依据不足，需人工复核";
const DEFAULT_CONTINUE_RATIONALE = "LLM判断依据不足，已按客户配置完成字段兜底";

const OUTPUT_SCHEMA = {
  name: "keyword_agent_batch_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rowNumber",
            "intent",
            "firstJudgement",
            "difficulty",
            "secondJudgement",
            "monetization",
            "thirdJudgement",
            "recommendation",
            "rationale",
            "rating"
          ],
          properties: {
            rowNumber: { type: "integer" },
            intent: { type: "string" },
            firstJudgement: { type: "string", enum: ["继续", "排除"] },
            difficulty: { type: "string" },
            secondJudgement: { type: "string", enum: ["推荐", "不推荐", ""] },
            monetization: { type: "string", enum: ["广告", "轻saas", "其他", ""] },
            thirdJudgement: { type: "string", enum: ["推荐", "不推荐", ""] },
            recommendation: { type: "string" },
            rationale: { type: "string" },
            rating: { type: "string", enum: ["A", "B", "C", ""] }
          }
        }
      }
    }
  }
};

function compactRecord(record, headers) {
  return Object.fromEntries(headers.map((header) => [header, record?.[header] || ""]));
}

function channelsFromRule(rule) {
  return [rule?.["变现渠道1"], rule?.["变现渠道2"]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function abilitiesFromRule(rule) {
  return [rule?.["能力1"], rule?.["能力2"]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function desiredIntent(rule) {
  return String(rule?.["意图"] || "工具站").trim() || "工具站";
}

function normalizeMonetization(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "轻saas" || text === "轻saas".toLowerCase()) {
    return "轻saas";
  }
  if (text === "广告" || text === "ad" || text === "ads" || text === "adsense") {
    return "广告";
  }
  if (text === "其他" || text === "other") {
    return "其他";
  }
  return "";
}

function normalizeAllowedChannels(channels) {
  return (Array.isArray(channels) ? channels : [])
    .map((channel) => normalizeMonetization(channel))
    .filter(Boolean);
}

function customerConfigFromRule(rule) {
  return {
    desiredIntent: desiredIntent(rule),
    allowedMonetizationChannels: normalizeAllowedChannels(channelsFromRule(rule))
  };
}

function normalizeCustomerConfig(row, customerConfig = {}) {
  const fromRule = customerConfigFromRule(row?.rule || {});
  const desired = String(customerConfig.desiredIntent || fromRule.desiredIntent || "工具站").trim() || "工具站";
  const channels = Array.isArray(customerConfig.allowedMonetizationChannels)
    ? customerConfig.allowedMonetizationChannels
    : fromRule.allowedMonetizationChannels;
  return {
    desiredIntent: desired,
    allowedMonetizationChannels: normalizeAllowedChannels(channels)
  };
}

function warning(warnings, field, reason, from, to) {
  warnings.push({
    field,
    reason,
    from: String(from ?? ""),
    to: String(to ?? "")
  });
}

function correctedValue({
  field,
  value,
  fallback,
  isValid,
  warnings,
  reason
}) {
  if (isValid(value)) {
    return value;
  }
  warning(warnings, field, reason, value, fallback);
  return fallback;
}

function correctedRationale({ value, fallback, maxLength = 80, minLength = 1, warnings }) {
  const raw = String(value || "").trim();
  if (!raw || raw.length < minLength) {
    const text = fallback.slice(0, maxLength);
    warning(warnings, "判断依据", "判断依据缺失或过短，已兜底", raw, text);
    return text;
  }
  if (raw.length > maxLength) {
    const text = raw.slice(0, maxLength);
    warning(warnings, "判断依据", "判断依据超过长度限制，已截断", raw, text);
    return text;
  }
  return raw;
}

function correctedRecommendation(value, warnings) {
  const raw = String(value || "").trim();
  if (!raw) {
    const fallback = "先做轻量MVP验证";
    warning(warnings, "建议", "建议缺失，已兜底", raw, fallback);
    return fallback;
  }
  if (raw.length > 50) {
    const text = raw.slice(0, 50);
    warning(warnings, "建议", "建议超过长度限制，已截断", raw, text);
    return text;
  }
  return raw;
}

function normalizedDifficulty(value, warnings) {
  const text = String(value || "").trim();
  if (/^[轻中重]：.+/.test(text)) {
    return text;
  }
  const fallback = "中：需人工复核实现难度";
  warning(warnings, "难度", "难度格式不合法，已兜底", text, fallback);
  return fallback;
}

function computeRating(secondJudgement, thirdJudgement) {
  if (secondJudgement === "推荐" && thirdJudgement === "推荐") {
    return "A";
  }
  if (secondJudgement === "不推荐" && thirdJudgement === "不推荐") {
    return "C";
  }
  return "B";
}

function rowNumberFor(row, llmOutput) {
  return Number(llmOutput?.rowNumber || row?.rowNumber || row?.row?.rowNumber || 0);
}

function buildPromptPayload(items) {
  return {
    task: "Classify keyword opportunities for a keyword research spreadsheet.",
    rules: {
      trafficAssumption: "Rows are already filtered to bing二次判断=继续. Treat Bing traffic and low exact-match-domain competition as already validated. Do not add extra KD/search-volume thresholds.",
      firstJudgement: "intent must be either the customer desired intent or 其他. If intent is customer desired intent, firstJudgement=继续. If intent=其他, firstJudgement=排除.",
      dynamicIntent: "Customer desired intent comes from 词根拓展.意图. Examples: 工具站 or B端展示站. Use that exact value when the keyword matches it.",
      exclude: [
        "adult/NSFW",
        "gambling/betting",
        "cracking/piracy/bypass paid products",
        "medical diagnosis or drug/dosage advice",
        "legal/tax high-risk advice",
        "financial/investment advice",
        "simple unit conversion, currency conversion, percentage math, or date/time arithmetic that Google/AI answers directly",
        "physical products, local services, installation, repair, jobs, salary, manuals, parts, prices, product-shopping terms"
      ],
      semanticWarnings: [
        "Do not classify by suffix alone. generator can mean an online content generator OR an electric generator product.",
        "honda generator, solar generator, portable generator, generac generator, whole house generator are physical product terms, not online tool-site demand.",
        "Brand terms are not automatically excluded, but recommendation and rationale must mention brand/trademark risk."
      ],
      difficulty: "Use format 轻：reason, 中：reason, or 重：reason. 推荐 only if light enough for Cloudflare edge/static/Workers/KV/D1/R2 and compatible with customer abilities. If abilities are empty, do not add ability constraints.",
      monetization: "Choose exactly one of 广告, 轻saas, 其他. If best channel is not listed in customer's 变现渠道1/2, thirdJudgement=不推荐. If both ad and SaaS are plausible, choose the more defensible one.",
      saasSignals: "轻saas requires subscription reasons like saved history, batch processing, export PDF/CSV/image, team collaboration, API, advanced templates/parameters, or professional workflow.",
      otherChannel: "If monetization=其他, thirdJudgement is 不推荐 unless there is a clear non-ad/non-SaaS path.",
      excludedRows: "If firstJudgement=排除, set difficulty, secondJudgement, monetization, thirdJudgement, recommendation, rating to empty strings. rationale should be a short reason.",
      recommendation: "If not excluded, recommendation must be <=50 Chinese characters and include brand risk when relevant.",
      rationale: "rationale must be <=80 Chinese characters.",
      rating: "Only if not excluded: secondJudgement+thirdJudgement both 推荐 => A; both 不推荐 => C; otherwise B."
    },
    rows: items.map((item) => ({
      rowNumber: item.rowNumber,
      keyword: item.keyword,
      keywordRow: compactRecord(item.keywordRecord, [
        "词根",
        "关键词",
        "国家",
        "搜索量",
        "KD",
        "3M展示",
        "top5根域名数量",
        "根域名1",
        "根域名1排名",
        "根域名2",
        "根域名2排名",
        "top 1国家",
        "top 1展示量"
      ]),
      customerConfig: {
        desiredIntent: desiredIntent(item.rule),
        allowedMonetizationChannels: channelsFromRule(item.rule),
        abilities: abilitiesFromRule(item.rule),
        root: item.rule?.["词根"] || "",
        rowIntent: item.rule?.["意图"] || ""
      }
    }))
  };
}

export function validateLLMOutput(row, llmOutput, customerConfig = {}) {
  const config = normalizeCustomerConfig(row, customerConfig);
  const decision = llmOutput || {};
  const warnings = [];
  const outputRowNumber = rowNumberFor(row, decision);
  let intent = String(decision.intent || "").trim();
  if (intent !== config.desiredIntent && intent !== "其他") {
    const fallback = decision.firstJudgement === "继续" ? config.desiredIntent : "其他";
    warning(warnings, "意图", "意图不在允许值内，已按客户配置兜底", intent, fallback);
    intent = fallback;
  }

  const firstJudgement = decision.firstJudgement === "继续" && intent !== "其他" ? "继续" : "排除";
  const excluded = firstJudgement === "排除";
  if (excluded) {
    const rationale = correctedRationale({
      value: decision.rationale,
      fallback: DEFAULT_EXCLUDED_RATIONALE,
      minLength: 20,
      maxLength: 80,
      warnings
    });
    return {
      rowNumber: outputRowNumber,
      values: {
        "意图": "其他",
        "第一次判断": "排除",
        "判断依据": rationale,
        [AGENT_STATUS_COLUMN]: "排除"
      },
      modelRationale: String(decision.rationale || "").trim(),
      warnings
    };
  }

  intent = correctedValue({
    field: "意图",
    value: intent,
    fallback: config.desiredIntent,
    isValid: (value) => value === config.desiredIntent,
    warnings,
    reason: "继续行意图必须等于客户目标意图"
  });

  const difficulty = normalizedDifficulty(decision.difficulty, warnings);
  const secondJudgement = correctedValue({
    field: "第二次判断",
    value: decision.secondJudgement,
    fallback: "不推荐",
    isValid: (value) => VALID_JUDGEMENTS.includes(value),
    warnings,
    reason: "第二次判断不合法，已兜底"
  });
  const monetization = correctedValue({
    field: "变现渠道",
    value: normalizeMonetization(decision.monetization),
    fallback: "其他",
    isValid: (value) => VALID_MONETIZATION_CHANNELS.includes(value),
    warnings,
    reason: "变现渠道不合法，已兜底"
  });
  const llmThirdJudgement = VALID_JUDGEMENTS.includes(decision.thirdJudgement)
    ? decision.thirdJudgement
    : "不推荐";
  const channelAllowed =
    config.allowedMonetizationChannels.length === 0 ||
    config.allowedMonetizationChannels.includes(monetization);
  const thirdJudgement = channelAllowed ? llmThirdJudgement : "不推荐";
  if (!VALID_JUDGEMENTS.includes(decision.thirdJudgement)) {
    warning(warnings, "第三次判断", "第三次判断不合法，已兜底", decision.thirdJudgement, thirdJudgement);
  } else if (decision.thirdJudgement !== thirdJudgement) {
    warning(warnings, "第三次判断", "变现渠道不在客户允许范围，已重算为不推荐", decision.thirdJudgement, thirdJudgement);
  }

  const rating = computeRating(secondJudgement, thirdJudgement);
  if (!VALID_RATINGS.includes(decision.rating) || decision.rating !== rating) {
    warning(warnings, "评级", "评级必须由第二次判断和第三次判断重算", decision.rating, rating);
  }

  const rationale = correctedRationale({
    value: decision.rationale,
    fallback: DEFAULT_CONTINUE_RATIONALE,
    maxLength: 80,
    warnings
  });

  return {
    rowNumber: outputRowNumber,
    values: {
      "意图": intent,
      "第一次判断": "继续",
      "难度": difficulty,
      "第二次判断": secondJudgement,
      "变现渠道": monetization,
      "第三次判断": thirdJudgement,
      "建议": correctedRecommendation(decision.recommendation, warnings),
      "判断依据": rationale,
      "评级": rating,
      [AGENT_STATUS_COLUMN]: "完成"
    },
    modelRationale: String(decision.rationale || "").trim(),
    warnings
  };
}

export function normalizeDecision(decision) {
  return validateLLMOutput(
    { rowNumber: decision?.rowNumber || 0 },
    decision,
    {
      desiredIntent: String(decision?.intent || "").trim() === "其他"
        ? "工具站"
        : String(decision?.intent || "工具站").trim(),
      allowedMonetizationChannels: VALID_MONETIZATION_CHANNELS
    }
  );
}

function extractJsonContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI response missing message content: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return content;
}

export async function evaluateKeywordRowsWithOpenAI(items, {
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL
} = {}) {
  if (items.length === 0) {
    return [];
  }
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY。要用大模型 agent，请先设置 OPENAI_API_KEY，或用 --mode=rules 跑规则兜底。");
  }

  const payload = buildPromptPayload(items);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a precise SEO keyword opportunity analyst. Return only valid JSON matching the schema. Think semantically, not by keyword suffix."
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: OUTPUT_SCHEMA
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI API failed: HTTP ${response.status} ${data?.error?.message || response.statusText}`);
  }

  const parsed = JSON.parse(extractJsonContent(data));
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const byRow = new Map(decisions.map((decision) => [Number(decision.rowNumber), decision]));
  return items.map((item) => {
    const decision = byRow.get(Number(item.rowNumber));
    if (!decision) {
      throw new Error(`OpenAI response missing decision for row ${item.rowNumber}`);
    }
    return validateLLMOutput(item, decision, customerConfigFromRule(item.rule));
  });
}
