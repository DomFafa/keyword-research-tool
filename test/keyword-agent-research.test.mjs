import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichItemsWithResearch,
  summarizeResearchForPrompt
} from "../src/lib/keyword-agent-research.mjs";
import {
  detectResearchNeeds,
  normalizeKeywordText
} from "../src/lib/keyword-research-boundary.mjs";
import { createMockResearchProvider } from "../src/lib/keyword-research-provider.mjs";

function item(keyword, rule = { "意图": "工具站", "变现渠道1": "广告", "变现渠道2": "轻saas" }) {
  return {
    rowNumber: 2,
    keyword,
    keywordRecord: { "关键词": keyword, "国家": "美国" },
    rule
  };
}

test("detectResearchNeeds flags brand boundary keywords", () => {
  const result = detectResearchNeeds({ keyword: "canva qr code generator" });

  assert.equal(result.needed, true);
  assert.equal(result.reasons.includes("brand_boundary"), true);
});

test("detectResearchNeeds flags technical uncertainty", () => {
  const result = detectResearchNeeds({ keyword: "ai voice generator" });

  assert.equal(result.needed, true);
  assert.equal(
    result.reasons.includes("technical_uncertainty") || result.reasons.includes("ambiguous_suffix"),
    true
  );
});

test("normalizeKeywordText removes punctuation and normalizes common separators", () => {
  assert.equal(normalizeKeywordText("401(k) Calculator"), "401 k calculator");
  assert.equal(normalizeKeywordText("OEM/ODM microphone factory"), "oem odm microphone factory");
});

test("detectResearchNeeds ignores known physical generators", () => {
  const result = detectResearchNeeds({ keyword: "honda generator" });

  assert.equal(result.needed, false);
});

test("detectResearchNeeds ignores generac generator even with brand and suffix signals", () => {
  const result = detectResearchNeeds({ keyword: "generac generator" });

  assert.equal(result.needed, false);
  assert.equal(result.level, "none");
});

test("detectResearchNeeds ignores financial education estimators", () => {
  const result = detectResearchNeeds({ keyword: "401k calculator" });

  assert.equal(result.needed, false);
});

test("detectResearchNeeds ignores punctuated 401k financial education estimators", () => {
  const result = detectResearchNeeds({ keyword: "401(k) calculator" });

  assert.equal(result.needed, false);
  assert.equal(result.level, "none");
});

test("detectResearchNeeds ignores savings calculator financial education estimators", () => {
  const result = detectResearchNeeds({ keyword: "savings calculator" });

  assert.equal(result.needed, false);
});

test("detectResearchNeeds ignores clear B2B showcase keywords", () => {
  const result = detectResearchNeeds({
    keyword: "gaming microphone manufacturer",
    rule: { "意图": "B端展示站" }
  });

  assert.equal(result.needed, false);
});

test("detectResearchNeeds ignores plural clear B2B showcase keywords", () => {
  const cases = [
    "gaming microphone manufacturers",
    "fpv drone suppliers",
    "memory chip distributors"
  ];

  for (const keyword of cases) {
    const result = detectResearchNeeds({
      keyword,
      rule: { "意图": "B端展示站" }
    });

    assert.equal(result.needed, false, keyword);
    assert.equal(result.level, "none", keyword);
  }
});

test("detectResearchNeeds still flags B2B keywords with technical uncertainty", () => {
  const result = detectResearchNeeds({
    keyword: "enterprise ai solution",
    rule: { "意图": "B端展示站" }
  });

  assert.equal(result.needed, true);
  assert.equal(result.reasons.includes("technical_uncertainty"), true);
});

test("detectResearchNeeds flags additional brand boundary keywords", () => {
  const result = detectResearchNeeds({ keyword: "adobe qr code generator" });

  assert.equal(result.needed, true);
  assert.equal(result.reasons.includes("brand_boundary"), true);
});

test("enrichItemsWithResearch disabled does not call provider", async () => {
  let calls = 0;
  const provider = {
    name: "mock",
    async researchKeyword() {
      calls += 1;
    }
  };
  const items = [item("canva qr code generator")];
  const result = await enrichItemsWithResearch(items, { enabled: false, provider });

  assert.equal(calls, 0);
  assert.equal(result, items);
});

test("enrichItemsWithResearch calls mock provider for needed rows", async () => {
  let calls = 0;
  const provider = createMockResearchProvider({
    "canva qr code generator": (input) => {
      calls += 1;
      return {
        provider: "mock",
        keyword: input.keyword,
        findings: [
          {
            title: "Canva QR Code Generator",
            url: "https://www.canva.com/",
            snippet: "Official Canva tool"
          }
        ],
        summary: "SERP shows official Canva tool dominance; brand risk is high.",
        confidence: "high"
      };
    }
  });

  const result = await enrichItemsWithResearch([item("canva qr code generator")], {
    enabled: true,
    provider
  });

  assert.equal(calls, 1);
  assert.equal(result[0].research.provider, "mock");
  assert.equal(result[0].research.summary.includes("Canva"), true);
  assert.equal(result[0].research.reasons.includes("brand_boundary"), true);
});

test("enrichItemsWithResearch respects maxResearchItems", async () => {
  let calls = 0;
  const provider = {
    name: "mock",
    async researchKeyword(input) {
      calls += 1;
      return {
        provider: "mock",
        keyword: input.keyword,
        findings: [],
        summary: "researched",
        confidence: "medium"
      };
    }
  };

  const result = await enrichItemsWithResearch([
    item("canva qr code generator"),
    item("adobe qr code generator"),
    item("ai voice generator")
  ], {
    enabled: true,
    provider,
    maxResearchItems: 1
  });

  assert.equal(calls, 1);
  assert.equal(result[1].research.skipped, true);
  assert.equal(result[1].research.skipReason, "max_research_items_reached");
  assert.equal(result[2].research.skipped, true);
});

test("enrichItemsWithResearch failOpen stores provider error", async () => {
  const provider = {
    name: "mock",
    async researchKeyword() {
      throw new Error("provider down");
    }
  };

  const result = await enrichItemsWithResearch([item("canva qr code generator")], {
    enabled: true,
    provider,
    failOpen: true
  });

  assert.equal(result[0].research.error, "provider down");
});

test("enrichItemsWithResearch failOpen false throws provider error", async () => {
  const provider = {
    name: "mock",
    async researchKeyword() {
      throw new Error("provider down");
    }
  };

  await assert.rejects(
    () => enrichItemsWithResearch([item("canva qr code generator")], {
      enabled: true,
      provider,
      failOpen: false
    }),
    /provider down/
  );
});

test("summarizeResearchForPrompt trims findings and summary", () => {
  const longSnippet = "x".repeat(200);
  const longSummary = "s".repeat(700);
  const result = summarizeResearchForPrompt({
    needed: true,
    reasons: ["brand_boundary"],
    confidence: "high",
    summary: longSummary,
    findings: [
      { title: "1", url: "https://example.com/1", snippet: longSnippet },
      { title: "2", url: "https://example.com/2", snippet: longSnippet },
      { title: "3", url: "https://example.com/3", snippet: longSnippet },
      { title: "4", url: "https://example.com/4", snippet: longSnippet }
    ]
  });

  assert.equal(result.topFindings.length, 3);
  assert.equal(result.topFindings[0].snippet.length, 160);
  assert.equal(result.summary.length, 500);
});
