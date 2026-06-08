import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildChromeLaunchArgs, resolveChromeProfileDirectory } from "../src/lib/cdp.mjs";

test("buildChromeLaunchArgs starts a debuggable Chrome profile", () => {
  const args = buildChromeLaunchArgs({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    port: 9222,
    userDataDir: "/tmp/keyword-research-tool/chrome-profile",
    profile: "Default"
  });

  assert.deepEqual(args, [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--remote-debugging-port=9222",
    "--user-data-dir=/tmp/keyword-research-tool/chrome-profile",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-save-password-bubble",
    "--disable-password-generation",
    "--password-store=basic",
    "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection,PasswordCheck,AutofillServerCommunication",
    "--profile-directory=Default"
  ]);
});

test("buildChromeLaunchArgs can open an initial URL", () => {
  const args = buildChromeLaunchArgs({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    port: 9222,
    userDataDir: "/tmp/profile",
    profile: "Default",
    initialUrl: "https://dash.3ue.com/zh-Hans/#/login"
  });

  assert.equal(args.at(-1), "https://dash.3ue.com/zh-Hans/#/login");
});

test("buildChromeLaunchArgs can omit profile directory", () => {
  const args = buildChromeLaunchArgs({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    port: 9333,
    userDataDir: "/tmp/profile",
    profile: ""
  });

  assert.equal(args.includes("--profile-directory="), false);
  assert.equal(args[1], "--remote-debugging-port=9333");
  assert.equal(args[2], "--user-data-dir=/tmp/profile");
});

test("resolveChromeProfileDirectory matches profile email", () => {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "chrome-profiles-"));
  mkdirSync(path.join(userDataDir, "Profile 7"));
  writeFileSync(
    path.join(userDataDir, "Profile 7", "Preferences"),
    JSON.stringify({
      profile: { name: "vcdom" },
      account_info: [{ email: "vc.ddom@gmail.com", full_name: "VC Dom" }]
    })
  );

  assert.equal(resolveChromeProfileDirectory("vc.ddom@gmail.com", userDataDir), "Profile 7");
});

test("resolveChromeProfileDirectory fails when email has no matching profile", () => {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "chrome-profiles-"));

  assert.throws(
    () => resolveChromeProfileDirectory("vc.ddom@gmail.com", userDataDir),
    /Cannot find Chrome profile "vc\.ddom@gmail\.com"/
  );
});

test("resolveChromeProfileDirectory can use an explicit profile directory in an empty root", () => {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "chrome-profiles-"));

  assert.equal(resolveChromeProfileDirectory("Profile 7", userDataDir), "Profile 7");
});

test("buildChromeLaunchArgs defaults to the vc.ddom@gmail.com profile", () => {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "chrome-profiles-"));
  mkdirSync(path.join(userDataDir, "Profile 4"));
  writeFileSync(
    path.join(userDataDir, "Profile 4", "Preferences"),
    JSON.stringify({
      profile: { name: "work" },
      account_info: [{ email: "vc.ddom@gmail.com" }]
    })
  );

  const args = buildChromeLaunchArgs({
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    port: 0,
    userDataDir
  });

  assert.equal(args[1], "--remote-debugging-port=0");
  assert.equal(args[2], `--user-data-dir=${userDataDir}`);
  assert.equal(args.at(-1), "--profile-directory=Profile 4");
});
