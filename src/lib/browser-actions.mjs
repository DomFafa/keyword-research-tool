import { evaluate, navigateAndWait } from "./cdp.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCondition(cdp, sessionId, expression, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await evaluate(cdp, sessionId, expression).catch((error) => ({
      __error: error.message
    }));
    if (lastValue === true || (lastValue && lastValue.ok)) {
      return lastValue;
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for condition: ${expression}. Last value: ${JSON.stringify(lastValue)}`);
}

export async function setInputValue(cdp, sessionId, selector, value) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: "selector not found", selector: ${JSON.stringify(selector)} };
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
      if (setter) {
        setter.call(el, ${JSON.stringify(value)});
      } else {
        el.value = ${JSON.stringify(value)};
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    })()`
  );
}

export async function clickSelector(cdp, sessionId, selector) {
  const result = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: "selector not found", selector: ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.reason || `Unable to click ${selector}`);
  }
  return result;
}

export async function clickByText(cdp, sessionId, options) {
  const { selector = "button, a", text, includes = false } = options;
  const result = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const expected = ${JSON.stringify(text)};
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = items.find((item) => {
        const actual = clean(item.innerText || item.textContent);
        return ${JSON.stringify(includes)} ? actual.includes(expected) : actual === expected;
      });
      if (!el) return { ok: false, reason: "text not found", text: expected };
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { ok: true, text: clean(el.innerText || el.textContent) };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.reason || `Unable to click text ${text}`);
  }
  return result;
}

export async function navigateIfNeeded(cdp, sessionId, url) {
  const currentUrl = await evaluate(cdp, sessionId, "location.href");
  if (currentUrl === url) {
    return;
  }
  await navigateAndWait(cdp, sessionId, url, 45000).catch(async () => {
    await sleep(3000);
  });
}
