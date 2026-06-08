import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeywordMagicRpcParams,
  keywordMagicMode,
  parseKeywordMagicRows
} from "../src/lib/semrush-page.mjs";

test("keyword magic RPC params encode match type and range filters", () => {
  assert.equal(keywordMagicMode("广泛匹配"), 0);
  assert.equal(keywordMagicMode("词组匹配"), 1);
  assert.equal(keywordMagicMode("完全匹配"), 2);
  assert.equal(keywordMagicMode("相关性"), 3);
  assert.equal(keywordMagicMode("所有关键词"), 4);

  const params = buildKeywordMagicRpcParams({
    query: "generator",
    country: "美国",
    matchType: "完全匹配",
    volumeMin: "1,000",
    volumeMax: "10000",
    kdMin: "0",
    kdMax: "30",
    page: 2
  });

  assert.deepEqual(params, {
    phrase: "generator",
    database: "us",
    mode: 2,
    domain: null,
    questions_only: false,
    groups: [],
    filter: {
      phrase: [],
      competition_level: [],
      cpc: [],
      difficulty: [
        { inverted: false, operation: 5, value: 0 },
        { inverted: false, operation: 4, value: 30 }
      ],
      results: [],
      serp_features: [{ inverted: false, value: [] }],
      volume: [
        { inverted: false, operation: 5, value: 1000 },
        { inverted: false, operation: 4, value: 10000 }
      ],
      words_count: [],
      phrase_include_logic: 0
    },
    currency: "USD",
    order: { field: "volume", direction: 1 },
    page: { number: 2, size: 100 }
  });
});

test("keyword magic RPC parser keeps rows needed by sheet output", () => {
  const rows = parseKeywordMagicRows({
    root: "generator",
    sourceQuery: "generator",
    page: 3,
    response: {
      result: {
        keywords: [
          { phrase: "ai image generator", volume: 823000, difficulty: 90 },
          { phrase: "no kd generator", volume: 1000, difficulty: null }
        ]
      }
    }
  });

  assert.deepEqual(rows, [
    {
      root: "generator",
      source_query: "generator",
      keyword: "ai image generator",
      volume: "823,000",
      kd: "90",
      semrush_page: 3
    }
  ]);
});
