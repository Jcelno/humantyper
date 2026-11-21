/* humantyper — calibration: replay recorded keystrokes against the prompt and
 * estimate profile parameters, shrinking each estimate toward the current value
 * in proportion to how little data supports it. */
(function (root) {
  "use strict";

  const PROMPTS = [
    "The sun rose over the quiet hills. Birds began to sing. A cool wind moved through the trees.",
    "Most people never think about how they type, yet every typist has a rhythm as distinctive as handwriting. Some letters come quickly, while unfamiliar combinations slow the hands down.",
    "Wait, what? You said (twice, actually) that the meeting was at 3:30; now it's 4:15! Well... we'll start late and \"learn\" from it.",
    "Alice and Bob flew from New York to San Francisco on Tuesday. They met Dr. Chen at the Golden Gate Bridge in July.",
  ];

  const GAP = 8; // seconds; longer gaps are interruptions, not typing
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const trim = (a, f = 0.05) => { const s = [...a].sort((x, y) => x - y); return s.slice(0, Math.max(1, Math.ceil(s.length * (1 - f)))); };
  const shrink = (x, n, prior, n0) => (x === null || !Number.isFinite(x) || n <= 0 ? prior : (n * x + n0 * prior) / (n + n0));

  /** session: { prompt, events: [[t_ms, kind("char"|"bs"), ch]] } */
  function replay(session) {
    const P = session.prompt;
    const buf = [];
    let good = 0;
    const keys = [];       // {t, ch, pos, correct, idx}
    const errors = [];     // {t, after, latency, fixed}
    let open = null, lastChar = null, lastBs = null;
    const bsGaps = [];
    session.events.forEach(([t, kind, ch], idx) => {
      t /= 1000;
      if (kind === "char") {
        const pos = buf.length, clean = good === pos;
        buf.push(ch);
        const correct = clean && ch === P[pos];
        if (correct) good++;
        keys.push({ t, ch, pos, correct, clean, idx });
        if (clean && !correct) { open = { t, pos, after: 0, latency: null, fixed: false }; errors.push(open); }
        else if (open && open.latency === null) open.after++;
        lastChar = t; lastBs = null;
      } else if (kind === "bs") {
        if (lastBs !== null) bsGaps.push(t - lastBs);
        lastBs = t;
        if (buf.length) { buf.pop(); good = Math.min(good, buf.length); }
        if (open && !open.fixed) {
          if (open.latency === null && lastChar !== null) open.latency = t - lastChar;
          if (buf.length <= open.pos) { open.fixed = true; open = null; }
        }
      }
    });
    const ts = session.events.map((e) => e[0] / 1000);
    let dur = 0;
    for (let i = 1; i < ts.length; i++) dur += Math.min(ts[i] - ts[i - 1], GAP);
    const correctChars = [...buf].filter((c, i) => c === P[i]).length;
    return { P, keys, errors, bsGaps, dur, correctChars, cleanKeys: keys.filter((k) => k.clean).length };
  }

  function analyze(sessions, prior) {
    const reps = sessions.map(replay);
    const within = [], wordStart = [], wordStartUp = [], sentence = [], punct = [], logs = [];
    for (const r of reps) {
      const k = r.keys;
      for (let j = 1; j < k.length; j++) {
        const a = k[j - 1], b = k[j];
        if (!(a.correct && b.correct && b.idx === a.idx + 1)) continue;
        const iki = b.t - a.t;
        if (iki <= 0 || iki > GAP) continue;
        const prev2 = r.P[b.pos - 2] || "";
        if (a.ch === " " && /[A-Za-z]/.test(b.ch)) {
          if (/[.!?]/.test(prev2)) sentence.push(iki);
          else (/[A-Z]/.test(b.ch) ? wordStartUp : wordStart).push(iki);
        } else if (/[a-z]/.test(b.ch) && /[A-Za-z]/.test(a.ch)) { within.push(iki); logs.push(Math.log(iki)); }
        else if (/[.,;:!?'"()-]/.test(b.ch)) punct.push(iki);
      }
    }
    const chars = reps.reduce((s, r) => s + r.correctChars, 0);
    const time = reps.reduce((s, r) => s + r.dur, 0);
    const keys = reps.reduce((s, r) => s + r.keys.length, 0);
    const wpmObs = time > 0 ? chars / 5 / (time / 60) : null;
    const base = mean(trim(within)) ?? 0.15;
    const med = median(within) ?? 0.12;
    const out = { ...prior };
    out.wpm = shrink(wpmObs, chars / 100, prior.wpm, 1);

    const typical = logs.filter((l) => l < Math.log(3.5 * med));
    if (typical.length > 20) {
      const m = mean(typical);
      const sd = Math.sqrt(mean(typical.map((l) => (l - m) ** 2)));
      out.jitter = shrink(Math.min(Math.max(sd * 0.8, 0.05), 0.9), typical.length / 10, prior.jitter, 5);
      const fast = typical.filter((l) => l < m - 0.25).length / typical.length;
      out.burstiness = shrink(Math.min(fast * 2.2, 1), typical.length / 20, prior.burstiness, 5);
    }
    const ws = mean(trim(wordStart, 0.02));
    if (ws !== null) out.wordPause = shrink(Math.max(ws - base, 0) / 1.1, wordStart.length, prior.wordPause, 8);
    const wu = mean(trim(wordStartUp, 0.02));
    const cap = wu !== null && ws !== null ? Math.max(wu - ws, 0) : null;
    out.capitalDelay = shrink(cap, wordStartUp.length, prior.capitalDelay, 6);
    const se = mean(trim(sentence, 0.02));
    if (se !== null) out.sentencePause = shrink(Math.max(se - base - out.capitalDelay, 0), sentence.length, prior.sentencePause, 4);
    const pu = mean(trim(punct, 0.02));
    if (pu !== null) out.punctDelay = shrink(Math.max(pu - base, 0), punct.length, prior.punctDelay, 6);

    const errs = reps.flatMap((r) => r.errors);
    const clean = reps.reduce((s, r) => s + r.cleanKeys, 0);
    if (clean) out.mistakeRate = shrink((100 * errs.length) / clean, clean / 100, prior.mistakeRate, 1);
    const fixed = errs.filter((e) => e.fixed);
    if (fixed.length) out.immediateFix = shrink(fixed.filter((e) => e.after === 0).length / fixed.length, fixed.length, prior.immediateFix, 4);
    const delayed = fixed.filter((e) => e.after > 0).map((e) => e.after);
    if (delayed.length) out.fixAfter = shrink(mean(delayed), delayed.length, prior.fixAfter, 4);
    const gaps = reps.flatMap((r) => r.bsGaps).filter((g) => g > 0 && g < 1.5);
    if (gaps.length) out.backspace = shrink(median(gaps), gaps.length / 2, prior.backspace, 4);
    const lat = fixed.map((e) => e.latency).filter((l) => l > 0 && l < GAP);
    if (lat.length) out.fixDelay = shrink(Math.max(mean(lat) - out.backspace, 0.05), lat.length, prior.fixDelay, 4);

    const level = keys < 400 ? "low" : keys < 1500 ? "medium" : "high";
    return {
      params: root.HT.clampParams(out),
      summary: { sessions: sessions.length, keystrokes: keys, wpm: wpmObs, errors: errs.length,
        errorRate: clean ? (100 * errs.length) / clean : 0, confidence: level },
    };
  }

  const API = { PROMPTS, replay, analyze };
  root.CAL = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
