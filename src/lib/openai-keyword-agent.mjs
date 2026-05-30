import { AGENT_STATUS_COLUMN } from "./keyword-agent-rules.mjs";

const DEFAULT_MODEL = "gpt-5.4-mini";
export { AGENT_STATUS_COLUMN };

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

export function normalizeDecision(decision) {
  const firstJudgement = decision.firstJudgement === "继续" ? "继续" : "排除";
  const excluded = firstJudgement === "排除" || decision.intent === "其他";
  if (excluded) {
    return {
      rowNumber: Number(decision.rowNumber),
      values: {
        "意图": "其他",
        "第一次判断": "排除",
        "判断依据": String(decision.rationale || "").trim().slice(0, 80),
        [AGENT_STATUS_COLUMN]: "排除"
      },
      modelRationale: String(decision.rationale || "").trim()
    };
  }

  return {
    rowNumber: Number(decision.rowNumber),
    values: {
      "意图": String(decision.intent || "").trim(),
      "第一次判断": "继续",
      "难度": String(decision.difficulty || "").trim(),
      "第二次判断": decision.secondJudgement === "推荐" ? "推荐" : "不推荐",
      "变现渠道": ["广告", "轻saas", "其他"].includes(decision.monetization) ? decision.monetization : "其他",
      "第三次判断": decision.thirdJudgement === "推荐" ? "推荐" : "不推荐",
      "建议": String(decision.recommendation || "").trim().slice(0, 50),
      "判断依据": String(decision.rationale || "").trim().slice(0, 80),
      "评级": ["A", "B", "C"].includes(decision.rating) ? decision.rating : "B",
      [AGENT_STATUS_COLUMN]: "完成"
    },
    modelRationale: String(decision.rationale || "").trim()
  };
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
  const byRow = new Map(decisions.map((decision) => [Number(decision.rowNumber), normalizeDecision(decision)]));
  return items.map((item) => {
    const decision = byRow.get(Number(item.rowNumber));
    if (!decision) {
      throw new Error(`OpenAI response missing decision for row ${item.rowNumber}`);
    }
    return decision;
  });
}
