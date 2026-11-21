/* humantyper — typing engine
 * Statistical keystroke timing + layout-aware mistakes with Backspace corrections.
 * Exposes window.HT (and module.exports under Node for testing).
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ random
  function rng(seed) {
    let a = seed >>> 0 || 1;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    next.gauss = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = next();
      v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    next.logn = (mean, sigma) => (mean <= 0 ? 0 : mean * Math.exp(next.gauss() * sigma - 0.5 * sigma * sigma));
    next.gamma2 = (mean) => { // gamma, shape 2
      const u1 = next() || 1e-9, u2 = next() || 1e-9;
      return -(mean / 2) * Math.log(u1 * u2);
    };
    return next;
  }

  // ------------------------------------------------------------------ parameters
  const PARAMS = [
    // key, label, group, min, max, step, default, unit, tip
    ["wpm", "Speed", "Speed", 15, 150, 1, 60, "wpm", "Average words per minute, including natural pauses."],
    ["variance", "Speed drift", "Speed", 0, 0.6, 0.01, 0.18, "", "How much the tempo wanders around the average."],
    ["jitter", "Keystroke jitter", "Speed", 0.02, 0.9, 0.01, 0.3, "", "Irregularity of individual key intervals."],
    ["burstiness", "Burstiness", "Rhythm", 0, 1, 0.01, 0.45, "", "Tendency to type in fast bursts."],
    ["burstLength", "Burst length", "Rhythm", 2, 60, 1, 14, "keys", "Average number of keys in a burst."],
    ["capitalDelay", "Capital delay", "Rhythm", 0, 0.6, 0.005, 0.09, "s", "Extra time to reach Shift."],
    ["punctDelay", "Punctuation delay", "Rhythm", 0, 0.8, 0.005, 0.11, "s", "Extra time around punctuation."],
    ["wordPause", "Word pause", "Pauses", 0, 1.5, 0.005, 0.1, "s", "Extra pause between words."],
    ["sentencePause", "Sentence pause", "Pauses", 0, 5, 0.01, 0.65, "s", "Pause after a sentence ends."],
    ["paragraphPause", "Paragraph pause", "Pauses", 0, 15, 0.05, 1.8, "s", "Pause before a new paragraph."],
    ["mistakeRate", "Mistake rate", "Mistakes", 0, 20, 0.1, 1.5, "%", "Chance a character is mistyped (0 = none)."],
    ["immediateFix", "Immediate fixes", "Mistakes", 0, 1, 0.01, 0.45, "", "Share of mistakes fixed right away."],
    ["fixAfter", "Chars before fixing", "Mistakes", 1, 10, 0.1, 2.5, "chars", "How far you type past a mistake before noticing."],
    ["fixDelay", "Reaction time", "Mistakes", 0.05, 2, 0.01, 0.32, "s", "Pause before pressing Backspace."],
    ["backspace", "Backspace speed", "Mistakes", 0.02, 0.5, 0.005, 0.11, "s", "Time between Backspace presses."],
  ];
  const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p[0], p[6]]));
  const GROUPS = ["Speed", "Rhythm", "Pauses", "Mistakes"];

  function clampParams(p) {
    const out = {};
    for (const [k, , , min, max, , def] of PARAMS) {
      let v = Number(p && p[k]);
      if (!Number.isFinite(v)) v = def;
      out[k] = Math.min(max, Math.max(min, v));
    }
    return out;
  }

  const PRESETS = [
    { name: "Consistent", params: { wpm: 60, variance: 0.05, jitter: 0.15, burstiness: 0, capitalDelay: 0.04, punctDelay: 0.04, wordPause: 0.03, sentencePause: 0.25, paragraphPause: 0.6, mistakeRate: 0 } },
    { name: "Casual", params: { wpm: 55, variance: 0.2, burstiness: 0.5, mistakeRate: 1.5, sentencePause: 0.8, paragraphPause: 2.2 } },
    { name: "Deliberate", params: { wpm: 35, variance: 0.12, jitter: 0.25, burstiness: 0.15, mistakeRate: 0.6, capitalDelay: 0.15, punctDelay: 0.3, wordPause: 0.18, sentencePause: 1.4, paragraphPause: 3.5, immediateFix: 0.7, fixDelay: 0.45 } },
    { name: "Fast typist", params: { wpm: 105, variance: 0.15, jitter: 0.32, burstiness: 0.65, burstLength: 20, mistakeRate: 2, capitalDelay: 0.05, punctDelay: 0.06, wordPause: 0.04, sentencePause: 0.35, paragraphPause: 1, fixDelay: 0.22, backspace: 0.07, fixAfter: 3 } },
  ].map((p) => ({ name: p.name, params: clampParams({ ...DEFAULTS, ...p.params }) }));

  // ------------------------------------------------------------------ keyboard (QWERTY)
  const ROWS = [["`1234567890-=", "~!@#$%^&*()_+", 0], ["qwertyuiop[]\\", "QWERTYUIOP{}|", 1.5],
    ["asdfghjkl;'", 'ASDFGHJKL:"', 1.75], ["zxcvbnm,./", "ZXCVBNM<>?", 2.25]];
  const KEYS = {};
  ROWS.forEach(([lo, up, off], y) => {
    for (let i = 0; i < lo.length; i++) {
      const x = off + i;
      const hand = x < 6.3 ? "L" : "R";
      const finger = hand === "L" ? (x < 2.4 ? 0 : x < 3.4 ? 1 : x < 4.4 ? 2 : 3) : (x < 8.4 ? 3 : x < 9.4 ? 2 : x < 10.4 ? 1 : 0);
      const k = { lo: lo[i], up: up[i], x, y, hand, finger };
      KEYS[lo[i]] = k;
      KEYS[up[i]] = k;
    }
  });
  function neighbors(ch) {
    const k = KEYS[ch];
    if (!k) return [];
    const shifted = ch === k.up && k.up !== k.lo;
    const out = [];
    const seen = new Set();
    for (const c in KEYS) {
      const o = KEYS[c];
      if (o === k || seen.has(o)) continue;
      seen.add(o);
      const d = Math.hypot(o.x - k.x, (o.y - k.y) * 1.1);
      if (d <= 1.3) {
        const t = shifted ? o.up : o.lo;
        let w = Math.exp(-d * d) * (o.y === k.y ? 1.6 : 1);
        if (/[a-z]/i.test(ch) && !/[a-z]/i.test(t)) w *= 0.25;
        out.push([t, w]);
      }
    }
    return out;
  }
  const needsShift = (ch) => { const k = KEYS[ch]; return !!k && ch === k.up && k.up !== k.lo; };

  const BIGRAMS = ("th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el ta la ns di fo ho pe ec pr no ct us ac ot il tr ly nc et ut ss so rs un lo wa ge ie wh ee wi em ad ol rt po we na ul ni ts mo ow pa im mi ai sh ir su id os iv ia am fi ci vi pl ig tu ev ld ry mp fe bl ab gh ty op wo sa ay ex ke fr oo av ag if ap gr od bo sp rd do uc bu ei ov by rm ep tt oc fa").split(" ");
  const BIRANK = Object.fromEntries(BIGRAMS.map((b, i) => [b, i]));

  function bigramFactor(a, b) {
    const ka = KEYS[a], kb = KEYS[b];
    let motor = 1.1;
    if (ka && kb) {
      if (ka === kb) motor = 1.05;
      else if (ka.hand !== kb.hand) motor = 0.88;
      else if (ka.finger === kb.finger) motor = 1.32;
      else motor = kb.finger > ka.finger ? 0.92 : 1.0;
    }
    if (/[a-z]/.test(a) && /[a-z]/.test(b)) {
      const r = BIRANK[a + b];
      return motor * (r === undefined ? 1.12 : 0.74 + 0.22 * (r / BIGRAMS.length));
    }
    return motor;
  }

  const isWord = (c) => !!c && /[\p{L}\p{N}'’_-]/u.test(c);
  const SENT_END = new Set([".", "!", "?", "…"]);
  const PUNCT = new Set([".", ",", ";", ":", "!", "?", "'", '"', "-", "—", "–", "…", "“", "”", "‘", "’"]);

  function graphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    }
    return Array.from(text);
  }

  function classFactor(c) {
    if (c === " ") return 0.92;
    if (/[a-z]/.test(c)) return 1.0;
    if (/[A-Z]/.test(c)) return 1.05;
    if (/[0-9]/.test(c)) return 1.35;
    if (PUNCT.has(c)) return 1.15;
    if (KEYS[c]) return 1.45;
    return 1.6;
  }

  // ------------------------------------------------------------------ mistakes
  function pickWeighted(r, items) {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let u = r() * total;
    for (const [v, w] of items) { u -= w; if (u <= 0) return v; }
    return items[items.length - 1][0];
  }
  const PUNCT_SWAP = { ",": ".", ".": ",", ";": ":", ":": ";", "!": "1", "?": "/", "'": ";" };

  function makeMistake(r, S, i) {
    const ch = S[i], prev = S[i - 1] || "", next = S[i + 1] || "";
    const opts = [];
    if (ch === " ") {
      if (/\w/.test(prev) && /\w/.test(next)) opts.push(["missing_space", 0.6]);
    } else if (/[a-zA-Z]/.test(ch)) {
      if (neighbors(ch).length) opts.push(["substitution", 5]);
      if (/[a-zA-Z]/.test(prev)) opts.push(["omission", 1.5]);
      opts.push(["duplication", 1]);
      if (/[a-zA-Z]/.test(next) && next.toLowerCase() !== ch.toLowerCase()) opts.push(["transposition", 1.5]);
      opts.push(["capitalization", /[A-Z]/.test(prev) && /[a-z]/.test(ch) ? 2.4 : 0.6]);
    } else if (PUNCT_SWAP[ch]) {
      opts.push(["punctuation", 0.5]);
    } else if (/[0-9]/.test(ch) && neighbors(ch).length) {
      opts.push(["substitution", 3]);
    }
    if (!opts.length) return null;
    const kind = pickWeighted(r, opts);
    switch (kind) {
      case "substitution": return { typed: [pickWeighted(r, neighbors(ch))], advance: 1 };
      case "omission": case "missing_space": return { typed: [], advance: 1 };
      case "duplication": return { typed: [ch, ch], advance: 1 };
      case "transposition": return { typed: [next, ch], advance: 2 };
      case "capitalization": return { typed: [ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()], advance: 1 };
      case "punctuation": return { typed: [PUNCT_SWAP[ch]], advance: 1 };
    }
    return null;
  }

  // ------------------------------------------------------------------ planner
  /**
   * plan(blocks, params, seed) → { events, total }
   * blocks: [{ type, runs: [{ text, styles: [] }] }]
   * events: { op: "block"|"char"|"bs", ch, styles, block, delay, progress, kind }
   */
  function plan(blocks, rawParams, seed) {
    const p = clampParams(rawParams);
    const r = rng(seed || 1);
    const spc = 12 / p.wpm;
    const sigma = Math.log1p(p.variance);
    const phi = 0.85;
    let x = 0, regime = "normal", regimeLeft = 10, sincePause = 0, careful = 0;
    let prevTyped = null, ctx = "";
    let progress = 0, mistakes = 0, fixes = 0;
    let expected = 0, actual = 0, drift = 0;
    const events = [];
    let carry = 0;

    function regimeDur(rg) {
      const L = p.burstLength;
      const mean = rg === "burst" ? L : rg === "slow" ? L * 0.8 : L * (2.2 - 1.6 * p.burstiness);
      return Math.max(1, Math.round(r.gamma2(mean)));
    }
    function units(prev, ch, wordStart) {
      x = phi * x + Math.sqrt(1 - phi * phi) * sigma * r.gauss();
      const latent = Math.exp(x - 0.5 * sigma * sigma);
      if (--regimeLeft <= 0) {
        const b = p.burstiness, u = r();
        let pb = 0.55 * b * (wordStart ? 1.3 : 0.9), ps = b > 0 ? 0.12 + 0.2 * b : 0;
        if (regime !== "normal") { pb *= 0.35; ps *= 0.35; }
        regime = b <= 0 ? "normal" : u < pb ? "burst" : u < pb + ps ? "slow" : "normal";
        regimeLeft = regimeDur(regime);
      }
      const reg = regime === "burst" ? 1 - 0.28 * Math.min(1, 0.4 + p.burstiness)
        : regime === "slow" ? 1 + 0.25 * Math.min(1, 0.4 + p.burstiness) : 1;
      let ramp = 1 + 0.3 * Math.exp(-sincePause / 8);
      if (careful > 0) { ramp *= 1.15; careful--; }
      sincePause++;
      let f = classFactor(ch);
      if (prev && prev.length === 1 && ch.length === 1) f *= 1 + 0.6 * (bigramFactor(prev.toLowerCase(), ch.toLowerCase()) - 1);
      return f * latent * reg * ramp * Math.exp(r.gauss() * p.jitter - 0.5 * p.jitter * p.jitter);
    }
    function cost(ch) {
      let c = 0;
      if (ch.length > 1 || (!KEYS[ch] && ch !== " ")) c += r.logn(0.35, 0.4);
      else if (/[A-Z]/.test(ch)) c += r.logn(p.capitalDelay, 0.35);
      else if (needsShift(ch)) c += r.logn(p.capitalDelay * 0.6, 0.35);
      if (PUNCT.has(ch)) c += r.logn(p.punctDelay, 0.4);
      return c;
    }
    function pauseBefore(S, i) {
      const ch = S[i];
      const prev = i > 0 ? S[i - 1] : ctx.slice(-1);
      const prev2 = i > 1 ? S[i - 2] : i === 1 ? ctx.slice(-1) : ctx.slice(-2, -1);
      let pause = 0;
      const wordStart = isWord(ch) && (prev === " " || prev === "");
      if (wordStart && prev === " " && SENT_END.has(prev2)) pause += r.logn(p.sentencePause, 0.55);
      else if (wordStart && prev === " ") {
        let len = 0;
        while (i + len < S.length && isWord(S[i + len])) len++;
        pause += r.logn(p.wordPause * (0.55 + 0.07 * Math.min(len, 14) + (len > 6 ? 0.5 : 0)), 0.55);
      }
      if (r() < 0.025) pause += r.logn(0.25, 0.55);
      if (pause > 1) sincePause = 0;
      return pause;
    }

    function typeSegment(text, styles, out, block) {
      const S = graphemes(text);
      const n = S.length;
      const typed = [];
      let good = 0, i = 0, frontier = 0, pending = null;
      const base = progress;
      const rate = p.mistakeRate / 100;
      const emit = (u, kind, pause) => {
        const ws = isWord(u) && (prevTyped === null || !isWord(prevTyped));
        const k = typed.length;
        typed.push(u);
        if (good === k && S[k] === u) good++;
        out.push({ op: "char", ch: u, styles, block, kind, units: units(prevTyped, u, ws),
          fixed: cost(u) + pause + carry, progress: base + good });
        carry = 0;
        prevTyped = u;
      };
      for (;;) {
        const atEnd = i >= n;
        if (pending) {
          const nxt = atEnd ? null : S[i];
          const boundary = nxt !== null && (!isWord(nxt) || !KEYS[nxt]);
          if (atEnd || boundary || pending.count >= pending.after) {
            const nBs = typed.length - good;
            for (let b = 0; b < nBs; b++) {
              typed.pop();
              out.push({ op: "bs", block, kind: "bs", units: 0,
                fixed: (b === 0 ? r.logn(p.fixDelay, 0.5) : 0) + r.logn(p.backspace * (b ? 0.85 : 1), 0.25) + carry,
                progress: base + Math.min(good, typed.length) });
              carry = 0;
            }
            if (!nBs) carry += r.logn(p.fixDelay, 0.5) * 0.5;
            carry += r.logn(0.12, 0.4);
            careful = 3;
            fixes++;
            i = good;
            prevTyped = typed[typed.length - 1] || null;
            pending = null;
            continue;
          }
        }
        if (atEnd) break;
        const u = S[i];
        const first = i >= frontier;
        const pause = first ? pauseBefore(S, i) : 0;
        let m = null;
        if (rate > 0 && !pending && i > 0 && (KEYS[u] || u === " ")) {
          if (r() < Math.min(rate * (regime === "burst" ? 1.4 : 1) * (careful ? 0.4 : 1), 0.6)) m = makeMistake(r, S, i);
        }
        if (m) {
          mistakes++;
          if (m.typed.length) m.typed.forEach((t, k) => emit(t, "error", k === 0 ? pause : 0));
          else carry += pause;
          i += m.advance;
          frontier = Math.max(frontier, i);
          let after = r() < p.immediateFix ? 0 : Math.min(1 + Math.round(r.gamma2(Math.max(p.fixAfter - 1, 0.01))), 12);
          if (!m.typed.length) after = Math.max(after, 1);
          pending = { after, count: 0 };
          continue;
        }
        emit(u, "char", pause);
        i++;
        frontier = Math.max(frontier, i);
        if (pending) pending.count++;
      }
      progress = base + n;
      ctx = (ctx + S.slice(-3).join("")).slice(-3);
    }

    function finalize(chunk, nUnits) {
      if (!chunk.length) return;
      const sd = sigma * 0.5;
      drift = 0.7 * drift + Math.sqrt(0.51) * sd * r.gauss();
      const nominal = nUnits * spc;
      let desired = nominal * Math.exp(drift - 0.5 * sd * sd) - 0.6 * (actual - expected);
      desired = Math.min(Math.max(desired, 0.35 * nominal), 3 * nominal);
      const U = chunk.reduce((s, e) => s + e.units, 0);
      const F = chunk.reduce((s, e) => s + e.fixed, 0);
      const scale = U > 0 ? Math.min(Math.max((desired - F) / U, spc * 0.45), spc * 4) : spc;
      for (const e of chunk) {
        e.delay = Math.max(e.units * scale + e.fixed, 0.008);
        delete e.units; delete e.fixed;
        actual += e.delay;
      }
      expected += nominal;
    }

    const total = blocks.reduce((s, b) => s + b.runs.reduce((t, run) => t + graphemes(run.text).length, 0), 0)
      + Math.max(blocks.length - 1, 0);
    blocks.forEach((block, bi) => {
      let chunk = [];
      let start = progress;
      if (bi > 0) {
        progress++;
        chunk.push({ op: "block", block: bi, kind: "enter", units: 1, fixed: 0, progress });
        carry += r.logn(p.paragraphPause * (block.type === "li" || block.type === "oli" ? 0.4 : 1), 0.55);
        sincePause = 0;
        prevTyped = null;
        ctx = (ctx + "\n").slice(-3);
      }
      for (const run of block.runs) {
        // long runs are split at spaces so the rate controller stays local
        const parts = run.text.length > 500 ? run.text.match(/[\s\S]{1,400}(\s|$)|[\s\S]{1,400}/g) : [run.text];
        for (const part of parts) {
          if (!part) continue;
          typeSegment(part, run.styles, chunk, bi);
          if (progress - start >= 450) {      // rate-control checkpoint inside long paragraphs
            finalize(chunk, progress - start);
            for (const e of chunk) events.push(e);
            chunk = [];
            start = progress;
          }
        }
      }
      finalize(chunk, progress - start);
      for (const e of chunk) events.push(e);
    });
    if (events.length) events[0].delay = Math.min(events[0].delay, 0.05);
    return { events, total, mistakes, fixes };
  }

  // ------------------------------------------------------------------ mock editor replay
  /** Apply events to a list of blocks [{type, chars:[{ch, styles}]}] (in place). */
  function apply(state, ev, meta) {
    if (ev.op === "block") state.push({ type: meta[ev.block].type, chars: [] });
    else if (ev.op === "char") state[state.length - 1].chars.push({ ch: ev.ch, styles: ev.styles });
    else if (ev.op === "bs") state[state.length - 1].chars.pop();
  }

  const API = { rng, PARAMS, GROUPS, DEFAULTS, PRESETS, clampParams, plan, apply, graphemes, neighbors, isWord, KEYS, SENT_END };
  root.HT = Object.assign(root.HT || {}, API);
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
