/* humantyper helper — types a prepared list of actions into a Google Docs tab.
 * Keystrokes are sent with the Chrome DevTools Protocol (chrome.debugger), which
 * produces real key events that Google Docs accepts. Chrome shows a
 * "started debugging this browser" bar while typing; clicking Cancel stops it. */
"use strict";

const DOCS = "https://docs.google.com/document/";
let job = null; // { tabId, actions, i, state, message, stop }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

function keyInfo(k) {
  if (/^[a-z]$/.test(k)) return { key: k, code: "Key" + k.toUpperCase(), vk: k.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(k)) return { key: k, code: "Digit" + k, vk: 48 + Number(k) };
  if (k === "Backspace") return { key: k, code: k, vk: 8 };
  if (k === "Enter") return { key: k, code: k, vk: 13, text: "\r" };
  if (k === "Tab") return { key: k, code: k, vk: 9 };
  return { key: k, code: "", vk: 0 };
}

async function send(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function perform(tabId, a) {
  if (a.t === "text") {
    const c = a.text;
    if ([...c].length === 1 && c.codePointAt(0) <= 0xffff && c >= " ") {
      await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: c, text: c, unmodifiedText: c });
      await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: c });
    } else {
      await send(tabId, "Input.insertText", { text: c });   // emoji and combined characters
    }
  } else {
    const info = keyInfo(a.key);
    const modifiers = (a.mods || []).reduce((m, x) => m | (MOD[x] || 0), 0);
    const base = { key: info.key, code: info.code, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk, modifiers };
    await send(tabId, "Input.dispatchKeyEvent", { type: info.text && !modifiers ? "keyDown" : "rawKeyDown", ...base,
      ...(info.text && !modifiers ? { text: info.text, unmodifiedText: info.text } : {}) });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

async function findTarget(target) {
  // tests may target a local page; everything else goes to Google Docs only
  const prefix = target && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(target) ? target : DOCS;
  const tabs = (await chrome.tabs.query({})).filter((t) => t.url && t.url.startsWith(prefix));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0] || null;
}

async function run(msg) {
  const tab = await findTarget(msg.target);
  if (!tab) throw new Error("No Google Doc is open. Open your document in another tab first.");
  const j = (job = { tabId: tab.id, actions: msg.actions, i: 0, state: "countdown", message: "", stop: false,
    profile: typeof msg.profile === "string" ? msg.profile.slice(0, 60) : "" });
  await chrome.debugger.attach({ tabId: tab.id }, "1.3");
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    for (let s = Math.max(0, msg.countdown ?? 3); s > 0 && !j.stop; s--) { j.message = `Starting in ${s}…`; await sleep(1000); }
    j.state = "typing"; j.message = "";
    for (; j.i < j.actions.length && !j.stop; j.i++) {
      const a = j.actions[j.i];
      let wait = Math.max(0, a.delay || 0) * 1000;
      while (wait > 0 && !j.stop) { const s = Math.min(wait, 100); await sleep(s); wait -= s; }
      if (j.stop) break;
      await perform(tab.id, a);
    }
    j.state = j.stop ? "stopped" : "done";
  } catch (e) {
    j.state = j.stop ? "stopped" : "error";
    j.message = j.stop ? "" : String(e && e.message || e);
  } finally {
    clearInterval(keepAlive);
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
  }
}

function status() {
  if (!job) return { state: "idle" };
  return { state: job.state, done: job.i, total: job.actions.length, message: job.message, profile: job.profile };
}

function handle(msg, sendResponse) {
  if (!msg || typeof msg !== "object") return sendResponse({ ok: false });
  if (msg.cmd === "ping") return sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  if (msg.cmd === "status") return sendResponse({ ok: true, ...status() });
  if (msg.cmd === "stop") { if (job) job.stop = true; return sendResponse({ ok: true }); }
  if (msg.cmd === "start") {
    if (job && (job.state === "typing" || job.state === "countdown")) return sendResponse({ ok: false, error: "Already typing." });
    if (!Array.isArray(msg.actions) || !msg.actions.length) return sendResponse({ ok: false, error: "Nothing to type." });
    findTarget(msg.target).then((tab) => {
      if (!tab) return sendResponse({ ok: false, error: "No Google Doc is open. Open your document in another tab first." });
      sendResponse({ ok: true });
      run(msg).catch((e) => { job = { state: "error", actions: [], i: 0, message: String(e.message || e) }; });
    });
    return true;
  }
  sendResponse({ ok: false, error: "Unknown command" });
}

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => handle(msg, sendResponse));
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => handle(msg, sendResponse));
// Clicking "Cancel" on Chrome's debugging bar stops typing immediately
chrome.debugger.onDetach.addListener(() => { if (job) job.stop = true; });
