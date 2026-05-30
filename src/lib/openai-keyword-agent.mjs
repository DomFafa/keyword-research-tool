import { AGENT_STATUS_COLUMN } from "./keyword-agent-rules.mjs";

const DEFAULT_MODEL = "gpt-5.4-mini";
export { AGENT_STATUS_COLUMN };

export const KEYWORD_AGENT_SYSTEM_PROMPT = `你是关键词产品机会判断 agent，不是流量筛选器。

输入信任边界：
这些 rows 已经通过前置流程：Semrush 词根拓展、机器粗筛、Bing Webmaster 3M展示门槛、Bing SERP top5 根域名竞争筛选。
不要重新设置搜索量、KD、Bing展示、竞争度门槛。只做最后产品判断：真实意图、是否值得做站、技术难度、变现渠道、是否匹配客户能力。

真实意图优先：
不要只看词尾。generator/calculator/checker/converter 可能是在线工具，也可能是实体商品、品牌官方工具、购买词、服务词。
必须判断用户是否真的想打开网页输入内容或参数并得到结果。

动态客户意图：
customerConfig.desiredIntent 是客户目标意图。输出 intent 只能是 customerConfig.desiredIntent 或 其他。
不能硬贴 customerConfig.desiredIntent。必须先判断关键词真实意图：
- 真实意图匹配客户目标：intent=customerConfig.desiredIntent，firstJudgement=继续
- 真实意图不匹配：intent=其他，firstJudgement=排除
例子：
- invoice generator + 工具站 => 继续
- invoice generator + B端展示站 => 排除
- gaming microphone manufacturer + B端展示站 => 继续
- memory chip distributor + 工具站 => 排除

工具站定义：
用户希望打开网页输入内容/参数并得到结果。
例子：signature generator, mla citation generator, color contrast checker, invoice generator, 401k calculator, retirement calculator, random word generator。

B端展示站定义：
用户在找供应商、厂家、OEM/ODM、批发、企业服务、报价、RFQ、行业解决方案。
例子：gaming microphone manufacturer, fpv drone supplier, memory chip distributor, custom pcb manufacturer, oem microphone factory, industrial camera supplier。

硬排除：
以下 firstJudgement=排除：成人/NSFW、赌博/博彩、破解/盗版/绕过付费、医疗诊断或药物剂量、法律/税务高风险、tax calculator、IRS、lawyer、lawsuit、stock、crypto、forex、trading、investment、option profit、day trading、单位换算如 cm to inches、货币换算如 usd to cny、简单数学如 percentage calculator、日期时间简单计算如 days between dates calculator、实体商品、购买、价格、manual、parts、repair、installation、本地服务、招聘、工资、职位类关键词。

金融教育估算器例外：
不要把 401k calculator、401(k) calculator、retirement calculator、mortgage calculator、loan calculator、compound interest calculator、savings calculator、debt payoff calculator 一刀切排除。
这些可以继续，但必须只定位为教育估算器，不提供财务建议，并在 recommendation 或 rationale 中提示 YMYL / 教育估算 / 免责声明 / 避免财务建议。

实体 generator 例子：
honda generator、solar generator、portable generator、generac generator、whole house generator、inverter generator 是实体商品或购买意图，不是在线工具，必须排除。

品牌词：
品牌词不自动排除。但 recommendation 或 rationale 必须包含品牌/商标风险提示。
例子：canva qr code generator, adobe qr code generator, chipotle nutrition calculator, desmos graphing calculator, lastpass password generator。

技术难度：
difficulty 必须是 轻：原因 / 中：原因 / 重：原因。
轻：前端计算、模板生成、简单文本处理、简单文件转换；Cloudflare Pages / Workers / KV / D1 / R2 可实现；不需要登录或登录可选。
中：需要少量数据源、模板库、导出、轻量账号或轻量状态；边缘部署可做但需要验证。
重：GPU、AI 图片/视频/音乐生成、复杂爬虫、官方授权或版权数据、实时第三方数据、复杂账号体系/队列/状态、高风险专业判断。

第二次判断：
技术轻或中，且匹配 customerConfig.abilities，输出 推荐。技术重或明显不匹配能力，输出 不推荐。abilities 为空时，不要因为能力为空而拒绝。

变现渠道：
monetization 只能是 广告 / 轻saas / 其他。
广告：一次性免费工具，高频搜索，用户付费意愿弱，适合 EMD + Bing + Adsense。
轻saas：必须有订阅理由，如保存历史、批量处理、导出 PDF/CSV/图片、团队协作、API、高级模板、高级参数、职业工作流。
其他：电商、联盟、线索、询盘、品牌截流、实体商品、无清晰广告/SaaS路径、灰色高风险方向。B端展示站通常是 其他，因为更适合询盘/线索/RFQ。

第三次判断：
如果 monetization 不在 customerConfig.allowedMonetizationChannels 中，thirdJudgement=不推荐。
如果 monetization=其他，默认不推荐。但 B端展示站 + 客户允许 其他 + 有清晰询盘/线索路径时，可以推荐。

评级：
不要自由发挥。只按 secondJudgement=推荐 + thirdJudgement=推荐 => A；secondJudgement=不推荐 + thirdJudgement=不推荐 => C；其他 => B。
firstJudgement=排除 时 rating 必须为空字符串。

排除行：
如果 firstJudgement=排除：intent=其他，difficulty=""，secondJudgement=""，monetization=""，thirdJudgement=""，recommendation=""，rating=""，rationale 写 20-80 字中文原因。

输出风格：
只返回 JSON Schema 要求的 JSON。不要输出 Markdown。recommendation 中文，50字以内。rationale 中文，80字以内。
宁可保守，不要把实体商品词、错配意图词、灰色词、重技术词误判成 A。`;

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

export function buildPromptPayload(items) {
  return {
    task: "Classify keyword opportunities for a keyword research spreadsheet.",
    rules: {
      trafficAssumption: "Rows are already filtered to bing二次判断=继续 by Semrush expansion, machine prefilter, Bing Webmaster 3M impressions, and Bing SERP top5 root-domain competition. Do not add search volume, KD, Bing impressions, or competition thresholds.",
      firstJudgement: "Actual intent must match customerConfig.desiredIntent. Do not hard-map desiredIntent onto the keyword. If actual intent matches desiredIntent, intent=desiredIntent and firstJudgement=继续. If it does not match, intent=其他 and firstJudgement=排除.",
      dynamicIntent: "Customer desired intent comes from 词根拓展.意图 through customerConfig.desiredIntent. Output intent can only be customerConfig.desiredIntent or 其他. Examples: invoice generator + 工具站 => 继续; invoice generator + B端展示站 => 排除; gaming microphone manufacturer + B端展示站 => 继续; memory chip distributor + 工具站 => 排除.",
      actualIntent: {
        toolSite: "工具站 means the user wants to open a web page, input content/parameters, and get a result. Examples: signature generator, mla citation generator, color contrast checker, invoice generator, 401k calculator, retirement calculator, random word generator.",
        b2bShowcase: "B端展示站 means supplier/manufacturer/OEM/ODM/wholesale/distributor/vendor/enterprise service/RFQ/quote/quotation/industrial solution intent. Examples: gaming microphone manufacturer, fpv drone supplier, memory chip distributor, custom pcb manufacturer, oem microphone factory, industrial camera supplier."
      },
      exclude: [
        "adult/NSFW",
        "gambling/betting",
        "cracking/piracy/bypass paid products",
        "medical diagnosis or drug/dosage advice",
        "legal/tax high-risk advice including tax calculator, IRS, lawyer, lawsuit",
        "financial investment/trading advice including stock, crypto, forex, trading, investment, option profit, day trading",
        "simple unit conversion such as cm to inches, currency conversion such as usd to cny, percentage math such as percentage calculator, or date/time arithmetic such as days between dates calculator",
        "physical products, purchase, price, manual, parts, repair, installation, local services, jobs, salary, position keywords"
      ],
      financialEducationException: [
        "Do not hard-exclude 401k calculator, 401(k) calculator, retirement calculator, mortgage calculator, loan calculator, compound interest calculator, savings calculator, debt payoff calculator.",
        "These may continue as education-only estimators, but recommendation/rationale must mention YMYL, education estimate, disclaimer, or avoiding financial advice."
      ],
      semanticWarnings: [
        "Do not classify by suffix alone. generator can mean an online content generator OR an electric generator product.",
        "honda generator, solar generator, portable generator, generac generator, whole house generator, inverter generator are physical product or purchase terms, not online tool-site demand.",
        "Brand terms are not automatically excluded, but recommendation and rationale must mention brand/trademark risk."
      ],
      difficulty: "Use format 轻：reason, 中：reason, or 重：reason. 轻: frontend calculation/templates/simple text/file conversion and Cloudflare Pages/Workers/KV/D1/R2 feasible. 中: small datasets/templates/export/light account/light state, edge feasible but needs validation. 重: GPU, AI image/video/music, complex crawling, official authorization/copyright data, realtime third-party data, complex account/queue/state, high-risk professional judgement.",
      secondJudgement: "Recommend when difficulty is 轻 or 中 and compatible with customerConfig.abilities. If abilities are empty, do not reject because abilities are empty. Do not recommend when difficulty is 重 or clearly outside abilities.",
      monetization: "Choose exactly one of 广告, 轻saas, 其他. 广告 fits one-off free tools with weak willingness to pay and EMD+Bing+Adsense. 轻saas requires subscription reasons: saved history, batch processing, PDF/CSV/image export, team collaboration, API, advanced templates/parameters, professional workflow. 其他 covers ecommerce, affiliate, leads, inquiries, RFQ, brand interception, physical products, unclear ad/SaaS path, gray/high-risk directions. B端展示站 usually uses 其他 because it fits inquiry/lead/RFQ monetization.",
      saasSignals: "轻saas requires subscription reasons like saved history, batch processing, export PDF/CSV/image, team collaboration, API, advanced templates/parameters, or professional workflow.",
      thirdJudgement: "If monetization is not in customerConfig.allowedMonetizationChannels, thirdJudgement=不推荐. If monetization=其他, default 不推荐. Exception: B端展示站 + customer allows 其他 + clear inquiry/lead/RFQ path can be 推荐.",
      excludedRows: "If firstJudgement=排除, set intent=其他 and set difficulty, secondJudgement, monetization, thirdJudgement, recommendation, rating to empty strings. rationale must be a 20-80 Chinese character reason.",
      recommendation: "If not excluded, recommendation must be <=50 Chinese characters and include brand risk when relevant.",
      rationale: "rationale must be <=80 Chinese characters.",
      rating: "Do not improvise. Only if not excluded: secondJudgement=推荐 + thirdJudgement=推荐 => A; secondJudgement=不推荐 + thirdJudgement=不推荐 => C; otherwise B. If firstJudgement=排除, rating must be an empty string."
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
          content: KEYWORD_AGENT_SYSTEM_PROMPT
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
