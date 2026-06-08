import assert from "node:assert/strict";
import test from "node:test";
import { buildSemrushLaunchOptions, DASH_LOGIN_URL } from "../src/lib/semrush-browser.mjs";

test("Semrush login URL points to the 3ue login page", () => {
  assert.equal(DASH_LOGIN_URL, "https://dash.3ue.com/zh-Hans/#/login");
});

test("Semrush Chrome launch options use a normal visible Chrome without CDP flags", () => {
  const options = buildSemrushLaunchOptions({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });

  assert.equal(options.executablePath, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(options.headless, false);
  assert.equal(options.viewport, null);
  assert.equal(options.args.includes("--remote-debugging-port=0"), false);
  assert.equal(options.args.includes("--no-first-run"), true);
  assert.equal(options.args.includes("--no-default-browser-check"), true);
});
