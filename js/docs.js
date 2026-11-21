/* humantyper — turn planned keystrokes into Google Docs actions and hand them to
 * the helper extension, which types them into the open Google Doc. */
(function (root) {
  "use strict";
  const EXT_ID = "maagcimkcgajlpbkienbakpmfchajlhl";
  const INLINE = ["b", "i", "u", "s"];

  function isMac() {
    const p = (typeof navigator !== "undefined" && ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform)) || "";
    return /mac/i.test(p);
  }

  /** Google Docs keyboard shortcuts (Windows/Linux vs Mac). */
  function shortcuts(mac) {
    const m = mac ? "meta" : "ctrl";
    return {
      b: { key: "b", mods: [m] }, i: { key: "i", mods: [m] }, u: { key: "u", mods: [m] },
      s: mac ? { key: "x", mods: ["meta", "shift"] } : { key: "5", mods: ["alt", "shift"] },
      h1: { key: "1", mods: [m, "alt"] }, h2: { key: "2", mods: [m, "alt"] }, h3: { key: "3", mods: [m, "alt"] },
      li: { key: "8", mods: [m, "shift"] }, oli: { key: "7", mods: [m, "shift"] },
    };
  }

  /**
   * toActions(meta, events, mac, formatted)
   * meta: parsed blocks; events: HT.plan(...).events
   * → [{ t: "text", text, delay } | { t: "key", key, mods?, delay }]
   */
  function toActions(meta, events, mac, formatted) {
    const K = shortcuts(mac);
    const out = [];
    const active = new Set();
    let list = null;
    const combo = (c, delay = 0.09) => out.push({ t: "key", key: c.key, mods: c.mods, delay });
    const isList = (t) => t === "li" || t === "oli";

    function blockFormat(prevType, type) {
      if (!formatted) return;
      if (list && list !== type) { combo(K[list]); list = null; }       // leave the list
      if (isList(type) && list !== type) { combo(K[type]); list = type; } // enter a list
      if (/^h[123]$/.test(type)) combo(K[type]);
    }
    if (meta.length) blockFormat(null, meta[0].type);

    for (const ev of events) {
      if (ev.op === "block") {
        for (const s of INLINE) if (active.has(s)) { combo(K[s], 0.05); active.delete(s); }
        out.push({ t: "key", key: "Enter", delay: ev.delay });
        blockFormat(meta[ev.block - 1] && meta[ev.block - 1].type, meta[ev.block].type);
      } else if (ev.op === "bs") {
        out.push({ t: "key", key: "Backspace", delay: ev.delay });
      } else {
        let delay = ev.delay;
        if (formatted) {
          const want = new Set(ev.styles.filter((s) => INLINE.includes(s)));
          for (const s of INLINE) {
            if (active.has(s) !== want.has(s)) {
              combo(K[s], delay);
              delay = 0.06;
              want.has(s) ? active.add(s) : active.delete(s);
            }
          }
        }
        out.push({ t: "text", text: ev.ch, delay });
      }
    }
    for (const s of INLINE) if (active.has(s)) combo(K[s], 0.05);
    return out;
  }

  // ------------------------------------------------------------------ bridge
  function send(msg) {
    return new Promise((resolve) => {
      const rt = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
      if (!rt) return resolve(null);
      try {
        chrome.runtime.sendMessage(EXT_ID, msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch { resolve(null); }
    });
  }

  const API = { EXT_ID, isMac, shortcuts, toActions, send };
  root.DOCS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
