/* humantyper — text → blocks (plain or Markdown) and blocks → HTML */
(function (root) {
  "use strict";

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function inline(text, styles = [], out = []) {
    let buf = "";
    const flush = () => { if (buf) { out.push({ text: buf, styles }); buf = ""; } };
    const tokens = [["**", "b"], ["__", "b"], ["~~", "s"], ["++", "u"], ["*", "i"], ["_", "i"], ["`", "code"]];
    let i = 0;
    outer: while (i < text.length) {
      const c = text[i];
      if (c === "\\" && i + 1 < text.length && /[\\`*_~+#\[\]()>!-]/.test(text[i + 1])) { buf += text[i + 1]; i += 2; continue; }
      if (c === "[") {
        const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(text.slice(i));
        if (m) { flush(); inline(m[1], styles, out); i += m[0].length; continue; }
      }
      for (const [tok, st] of tokens) {
        if (!text.startsWith(tok, i)) continue;
        const after = text[i + tok.length];
        if (!after || after === " ") continue;
        if (tok === "_" && /\w/.test(text[i - 1] || "")) continue;
        let j = i + tok.length;
        for (;;) {
          j = text.indexOf(tok, j);
          if (j < 0) break;
          if (text[j - 1] !== " " && !(tok.length === 1 && text[j + 1] === tok)) break;
          j += tok.length;
        }
        if (j > i + tok.length) {
          flush();
          const inner = text.slice(i + tok.length, j);
          if (st === "code") out.push({ text: inner, styles: [...styles, "code"] });
          else inline(inner, styles.includes(st) ? styles : [...styles, st], out);
          i = j + tok.length;
          continue outer;
        }
      }
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /** Parse text into blocks. mode: "markdown" | "plain" */
  function parse(text, mode) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (mode !== "markdown") return lines.map((l) => ({ type: "p", runs: l ? [{ text: l, styles: [] }] : [] }));
    const blocks = [];
    let para = null;
    let inCode = false;
    const flush = () => { if (para) { blocks.push({ type: "p", runs: inline(para.join("\n")) }); para = null; } };
    for (const line of lines) {
      if (/^\s*```/.test(line)) { flush(); inCode = !inCode; continue; }
      if (inCode) { blocks.push({ type: "code", runs: line ? [{ text: line, styles: ["code"] }] : [] }); continue; }
      let m;
      if (!line.trim()) { flush(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: "h" + Math.min(m[1].length, 3), runs: inline(m[2]) }); continue; }
      if ((m = /^(\s*)[-*+•]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: "li", depth: Math.floor(m[1].length / 2), runs: inline(m[2]) }); continue; }
      if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: "oli", depth: Math.floor(m[1].length / 2), num: +m[2], runs: inline(m[3]) }); continue; }
      if ((m = /^>\s?(.*)$/.exec(line))) { flush(); blocks.push({ type: "quote", runs: inline(m[1]) }); continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ type: "hr", runs: [] }); continue; }
      (para = para || []).push(line.trim());
    }
    flush();
    return blocks;
  }

  function runsHTML(runs) {
    return runs.map((r) => {
      let t = esc(r.text).replace(/\n/g, "<br>");
      for (const [s, tag] of [["code", "code"], ["s", "s"], ["u", "u"], ["i", "em"], ["b", "strong"]]) {
        if (r.styles.includes(s)) t = `<${tag}>${t}</${tag}>`;
      }
      return t;
    }).join("");
  }

  /** Render blocks (with runs, or with typed chars) to HTML. */
  function render(blocks) {
    let html = "";
    const numbers = {};
    for (const b of blocks) {
      const runs = b.runs || charsToRuns(b.chars || []);
      const inner = runsHTML(runs) || "&#8203;";
      const pad = b.depth ? ` style="margin-left:${b.depth * 1.25}em"` : "";
      if (b.type !== "oli") for (const k in numbers) delete numbers[k];
      if (/^h\d$/.test(b.type)) html += `<${b.type}>${inner}</${b.type}>`;
      else if (b.type === "li") html += `<div class="li"${pad}><span class="mk">•</span>${inner}</div>`;
      else if (b.type === "oli") {
        const d = b.depth || 0;
        numbers[d] = (numbers[d] || 0) + 1;
        html += `<div class="li"${pad}><span class="mk">${numbers[d]}.</span>${inner}</div>`;
      } else if (b.type === "quote") html += `<blockquote>${inner}</blockquote>`;
      else if (b.type === "code") html += `<pre>${inner}</pre>`;
      else if (b.type === "hr") html += "<hr>";
      else html += `<p>${inner}</p>`;
    }
    return html;
  }

  function charsToRuns(chars) {
    const runs = [];
    for (const c of chars) {
      const last = runs[runs.length - 1];
      const key = c.styles.join();
      if (last && last.key === key) last.text += c.ch;
      else runs.push({ text: c.ch, styles: c.styles, key });
    }
    return runs;
  }

  const API = { parse, render, esc };
  root.MD = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
