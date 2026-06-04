import assert from "node:assert/strict";
import test from "node:test";
import {
  detectWorkspacePageState,
  GET_STARTED_LABELS,
  includesAnyLabel,
  isWorkspaceBuyPage,
  NEXT_LABELS,
  WORKSPACE_PAGE_STATES
} from "../src/lib/workspace-domain-page.mjs";

test("detectWorkspacePageState maps Google Workspace signup URLs", () => {
  assert.equal(
    detectWorkspacePageState("https://workspace.google.com/business/"),
    WORKSPACE_PAGE_STATES.LANDING
  );
  assert.equal(
    detectWorkspacePageState("https://workspace.google.com/business/signup/welcome?hl=en"),
    WORKSPACE_PAGE_STATES.WELCOME
  );
  assert.equal(
    detectWorkspacePageState("https://workspace.google.com/business/signup/contact?hl=en"),
    WORKSPACE_PAGE_STATES.CONTACT
  );
  assert.equal(
    detectWorkspacePageState("https://workspace.google.com/business/signup/signuptypeselect?hl=en"),
    WORKSPACE_PAGE_STATES.SIGNUP_TYPE_SELECT
  );
  assert.equal(
    detectWorkspacePageState("https://workspace.google.com/business/signup/buy?hl=en"),
    WORKSPACE_PAGE_STATES.BUY
  );
});

test("isWorkspaceBuyPage only matches the domain-buy target page", () => {
  assert.equal(isWorkspaceBuyPage("https://workspace.google.com/business/signup/buy?hl=en"), true);
  assert.equal(isWorkspaceBuyPage("https://workspace.google.com/business/signup/contact?hl=en"), false);
});

test("button label matching supports multilingual get-started and next labels", () => {
  assert.equal(includesAnyLabel("Get started", GET_STARTED_LABELS), true);
  assert.equal(includesAnyLabel("Başlayın", GET_STARTED_LABELS), true);
  assert.equal(includesAnyLabel("开始使用", GET_STARTED_LABELS), true);
  assert.equal(includesAnyLabel("Next", NEXT_LABELS), true);
  assert.equal(includesAnyLabel("Devam", NEXT_LABELS), true);
  assert.equal(includesAnyLabel("继续", NEXT_LABELS), true);
});
