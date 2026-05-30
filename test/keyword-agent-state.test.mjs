import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STATUS_COLUMN,
  shouldSkipKeywordAgentRow,
  validateHeaders
} from "../src/keyword-agent.mjs";

function row(values) {
  return { values };
}

test("keyword agent validates headers without optional agent status column", () => {
  assert.doesNotThrow(() => validateHeaders([
    "词根",
    "关键词",
    "bing二次判断",
    "意图",
    "第一次判断",
    "难度",
    "第二次判断",
    "变现渠道",
    "第三次判断",
    "建议",
    "判断依据",
    "评级"
  ]));
});

test("keyword agent skips terminal rows when optional agent status exists", () => {
  const headers = [
    "关键词",
    "意图",
    "第一次判断",
    "判断依据",
    AGENT_STATUS_COLUMN
  ];

  assert.deepEqual(shouldSkipKeywordAgentRow({
    headers,
    row: row(["done keyword", "工具站", "继续", "ok", "完成"]),
    force: false
  }), { skip: true, reason: "agent_status_done" });

  assert.deepEqual(shouldSkipKeywordAgentRow({
    headers,
    row: row(["excluded keyword", "其他", "排除", "not a tool", "排除"]),
    force: false
  }), { skip: true, reason: "agent_status_excluded" });
});

test("keyword agent force ignores terminal agent status", () => {
  const headers = ["关键词", "意图", "第一次判断", "判断依据", AGENT_STATUS_COLUMN];
  assert.deepEqual(shouldSkipKeywordAgentRow({
    headers,
    row: row(["done keyword", "工具站", "继续", "ok", "完成"]),
    force: true
  }), { skip: false, reason: "" });
});

test("keyword agent keeps old blank-column logic without agent status column", () => {
  const headers = ["关键词", "意图", "第一次判断", "判断依据"];

  assert.deepEqual(shouldSkipKeywordAgentRow({
    headers,
    row: row(["old done", "工具站", "继续", "ok"]),
    force: false
  }), { skip: true, reason: "target_columns_already_filled" });

  assert.deepEqual(shouldSkipKeywordAgentRow({
    headers,
    row: row(["old pending", "工具站", "继续", ""]),
    force: false
  }), { skip: false, reason: "" });
});
