/* humantyper — UI */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const KEY = "humantyper.v1";
  const SAMPLE = "# Hello there\n\nThis is how your **typing profile** feels. Familiar words fly by, while *unusual* ones slow things down.\n\n- Pauses gather at sentence ends\n- Mistakes get noticed and fixed\n\nPaste your own text on the left to try it.";

  // ------------------------------------------------------------------ state
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fresh = () => ({
    profiles: HT.PRESETS.map((p) => ({ id: uid(), name: p.name, params: { ...p.params }, cal: { sessions: [], summary: null } })),
    activeId: null, text: "", format: "markdown",
  });
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { S = fresh(); }
  if (!Array.isArray(S.profiles) || !S.profiles.length) S = fresh();
  S.profiles.forEach((p) => { p.params = HT.clampParams(p.params); p.cal = p.cal || { sessions: [], summary: null }; });
  if (!S.profiles.some((p) => p.id === S.activeId)) S.activeId = (S.profiles[1] || S.profiles[0]).id;
  let saveTimer;
  const flush = () => { clearTimeout(saveTimer); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 200); };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  const active = () => S.profiles.find((p) => p.id === S.activeId);

  // ------------------------------------------------------------------ text pane
  const text = $("#text"), preview = $("#preview");
  text.value = S.text || "";
  let view = "write";

  function setSeg(container, attr, value) {
    container.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset[attr] === value));
  }
  function fmtTime(sec) {
    if (!isFinite(sec)) return "–";
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m < 60 ? `${m}m ${String(s).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }
  function updateText() {
    const t = text.value;
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    $("#counts").textContent = `${t.length.toLocaleString()} characters · ${words.toLocaleString()} words`;
    const units = HT.graphemes(t).length;
    $("#estimate").textContent = units ? `≈ ${fmtTime((units * 12) / active().params.wpm)} with ${active().name}` : "";
    if (view === "preview") renderPreview();
  }
  function renderPreview() {
    const t = text.value;
    preview.innerHTML = t.trim() ? MD.render(MD.parse(t, S.format)) : `<p class="empty">Nothing to preview yet.</p>`;
  }
  text.addEventListener("input", () => { S.text = text.value; save(); updateText(); resetRun(); });
  $("#viewTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    view = b.dataset.view; setSeg($("#viewTabs"), "view", view);
    text.hidden = view !== "write"; preview.hidden = view !== "preview";
    if (view === "preview") renderPreview();
  });
  $("#formatTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.format = b.dataset.format; setSeg($("#formatTabs"), "format", S.format); save();
    if (view === "preview") renderPreview();
    resetRun();
  });
  setSeg($("#formatTabs"), "format", S.format);

  // ------------------------------------------------------------------ profile list
  const list = $("#profileList");
  let confirmDelete = null;

  function renderProfiles() {
    list.innerHTML = "";
    for (const p of S.profiles) {
      const li = document.createElement("li");
      li.className = "profile" + (p.id === S.activeId ? " active" : "");
      li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="tag">${Math.round(p.params.wpm)} wpm</span>
        <span class="acts">
          <button data-act="rename" title="Rename">✎</button>
          <button data-act="copy" title="Duplicate">⧉</button>
          ${confirmDelete === p.id ? `<button data-act="delete" class="confirm">Delete?</button>`
            : `<button data-act="delete" title="Delete"${S.profiles.length < 2 ? " disabled" : ""}>✕</button>`}
        </span>`;
      li.querySelector(".name").textContent = p.name;
      li.addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "rename") return rename(p, li);
        if (act === "copy") return duplicate(p);
        if (act === "delete") return remove(p);
        if (e.target.tagName === "INPUT") return;
        confirmDelete = null;
        if (p.id !== S.activeId) { S.activeId = p.id; save(); onProfileChange(); }
      });
      list.appendChild(li);
    }
  }
  function rename(p, li) {
    const span = li.querySelector(".name");
    const input = document.createElement("input");
    input.className = "name"; input.value = p.name; input.maxLength = 40;
    span.replaceWith(input); input.focus(); input.select();
    const done = (ok) => { if (ok && input.value.trim()) p.name = input.value.trim(); save(); renderProfiles(); updateText(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true));
  }
  function duplicate(p) {
    const q = { id: uid(), name: `${p.name} copy`, params: { ...p.params }, cal: JSON.parse(JSON.stringify(p.cal)) };
    S.profiles.splice(S.profiles.indexOf(p) + 1, 0, q);
    S.activeId = q.id; save(); onProfileChange();
  }
  function remove(p) {
    if (S.profiles.length < 2) return;
    if (confirmDelete !== p.id) { confirmDelete = p.id; renderProfiles(); return; }
    confirmDelete = null;
    const i = S.profiles.indexOf(p);
    S.profiles.splice(i, 1);
    if (S.activeId === p.id) S.activeId = S.profiles[Math.max(0, i - 1)].id;
    save(); onProfileChange();
  }
  $("#newProfile").addEventListener("click", () => {
    let n = S.profiles.length + 1;
    while (S.profiles.some((p) => p.name === `Profile ${n}`)) n++;
    const base = HT.PRESETS[1].params;
    const q = { id: uid(), name: `Profile ${n}`, params: { ...base }, cal: { sessions: [], summary: null } };
    S.profiles.push(q); S.activeId = q.id; save(); onProfileChange();
  });

  // ------------------------------------------------------------------ profile tabs
  let tab = "tune";
  $("#profileTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    tab = b.dataset.tab; setSeg($("#profileTabs"), "tab", tab);
    for (const t of ["tune", "calibrate", "run"]) $(`#tab-${t}`).hidden = t !== tab;
    if (tab !== "run") pauseRun();
    if (tab === "calibrate") $("#calInput").focus();
  });

  // ------------------------------------------------------------------ tune
  function fmtVal(v, step, unit) {
    const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return `${v.toFixed(d)}${unit ? " " + unit : ""}`;
  }
  function renderTune() {
    const box = $("#tab-tune");
    box.innerHTML = "";
    const p = active();
    for (const g of HT.GROUPS) {
      const h = document.createElement("div");
      h.className = "group-title"; h.textContent = g; box.appendChild(h);
      for (const [key, label, group, min, max, step, , unit, tip] of HT.PARAMS) {
        if (group !== g) continue;
        const row = document.createElement("div");
        row.className = "param"; row.title = tip;
        row.innerHTML = `<label for="p-${key}"></label><output></output>
          <input type="range" id="p-${key}" min="${min}" max="${max}" step="${step}">`;
        row.querySelector("label").textContent = label;
        const input = row.querySelector("input"), out = row.querySelector("output");
        const sync = () => {
          out.textContent = fmtVal(+input.value, step, unit);
          input.style.setProperty("--p", `${((input.value - min) / (max - min)) * 100}%`);
        };
        input.value = p.params[key]; sync();
        input.addEventListener("input", () => {
          p.params[key] = +input.value; sync(); save();
          if (key === "wpm") { list.querySelector(".profile.active .tag").textContent = `${Math.round(p.params.wpm)} wpm`; updateText(); }
          resetRun();
        });
        box.appendChild(row);
      }
    }
  }

  // ------------------------------------------------------------------ calibrate
  const calInput = $("#calInput");
  let promptIdx = 0, rec = null, doneInRun = new Set();

  function renderChips() {
    const box = $("#promptChips");
    box.innerHTML = "";
    CAL.PROMPTS.forEach((_, i) => {
      const b = document.createElement("button");
      b.textContent = `Prompt ${i + 1}`;
      b.className = (i === promptIdx ? "on " : "") + (doneInRun.has(i) ? "done" : "");
      b.addEventListener("click", () => { promptIdx = i; startCal(); });
      box.appendChild(b);
    });
  }
  function renderPrompt() {
    const P = CAL.PROMPTS[promptIdx], v = calInput.value;
    let good = 0;
    while (good < v.length && good < P.length && v[good] === P[good]) good++;
    const bad = Math.min(v.length, P.length);
    $("#promptView").innerHTML = `<span class="ok">${MD.esc(P.slice(0, good))}</span><span class="bad">${MD.esc(P.slice(good, bad))}</span>`
      + `<span class="next">${MD.esc(P.slice(bad, bad + 1))}</span>${MD.esc(P.slice(bad + 1))}`;
  }
  function startCal() {
    rec = { t0: null, events: [] };
    calInput.value = ""; calInput.disabled = false;
    $("#calLive").textContent = "Timing starts with your first key.";
    renderChips(); renderPrompt();
    if (tab === "calibrate") calInput.focus();
  }
  calInput.addEventListener("keydown", (e) => {
    if (!rec) return;
    if (e.ctrlKey || e.metaKey || e.altKey && e.key.length !== 1) { if (e.key !== "Shift") e.preventDefault(); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Delete", "Enter", "Tab", "PageUp", "PageDown"].includes(e.key)) {
      if (e.key !== "Tab") e.preventDefault(); return;
    }
    if (e.repeat) { e.preventDefault(); return; }
    const now = performance.now();
    if (e.key === "Backspace") {
      if (rec.t0 !== null) rec.events.push([now - rec.t0, "bs"]);
    } else if (e.key.length === 1 || [...e.key].length === 1) {
      if (rec.t0 === null) rec.t0 = now;
      rec.events.push([now - rec.t0, "char", e.key]);
    }
  });
  const keepEnd = () => { const n = calInput.value.length; if (calInput.selectionStart !== n || calInput.selectionEnd !== n) calInput.setSelectionRange(n, n); };
  ["paste", "drop", "cut"].forEach((ev) => calInput.addEventListener(ev, (e) => e.preventDefault()));
  ["click", "select", "focus"].forEach((ev) => calInput.addEventListener(ev, keepEnd));
  calInput.addEventListener("input", () => {
    renderPrompt();
    if (rec && rec.events.length > 1) {
      const t = rec.events[rec.events.length - 1][0] / 1000;
      if (t > 1) $("#calLive").textContent = `${Math.round(calInput.value.length / 5 / (t / 60))} wpm · ${rec.events.length} keys`;
    }
    if (calInput.value === CAL.PROMPTS[promptIdx]) finishCal();
  });
  function finishCal() {
    const p = active();
    p.cal.sessions.push({ prompt: CAL.PROMPTS[promptIdx], events: rec.events });
    if (p.cal.sessions.length > 40) p.cal.sessions.shift();
    save();
    doneInRun.add(promptIdx);
    calInput.disabled = true;
    $("#calLive").textContent = "Saved ✓";
    renderCalData();
    setTimeout(() => { promptIdx = (promptIdx + 1) % CAL.PROMPTS.length; startCal(); }, 700);
  }
  function renderCalData() {
    const c = active().cal;
    const keys = c.sessions.reduce((s, x) => s + x.events.length, 0);
    const conf = keys < 400 ? "low" : keys < 1500 ? "medium" : "high";
    $("#calMeter").style.width = `${Math.min(keys / 1500, 1) * 100}%`;
    $("#calStats").textContent = c.sessions.length
      ? `${c.sessions.length} session${c.sessions.length > 1 ? "s" : ""} · ${keys.toLocaleString()} keys · ${conf} confidence`
      : "No sessions yet";
    $("#calApply").disabled = !c.sessions.length;
    const s = c.summary;
    $("#calResult").textContent = s
      ? `Last update: measured ${Math.round(s.wpm || 0)} wpm, ${s.errorRate.toFixed(1)}% mistakes from ${s.keystrokes.toLocaleString()} keys (${s.confidence} confidence).`
      : "Do a few prompts, then update the profile. More keys → more accurate.";
  }
  $("#calApply").addEventListener("click", () => {
    const p = active();
    const res = CAL.analyze(p.cal.sessions, p.params);
    p.params = res.params; p.cal.summary = res.summary; save();
    renderProfiles(); renderTune(); renderCalData(); updateText(); resetRun();
  });
  let clearArmed = false;
  $("#calClear").addEventListener("click", () => {
    if (!clearArmed) { clearArmed = true; $("#calClear").textContent = "Clear data?"; setTimeout(() => { clearArmed = false; $("#calClear").textContent = "Clear"; }, 2500); return; }
    clearArmed = false; $("#calClear").textContent = "Clear";
    active().cal = { sessions: [], summary: null }; save(); renderCalData();
  });
  $("#calRestart").addEventListener("click", startCal);

  // ------------------------------------------------------------------ run (mock)
  const mockDoc = $("#mockDoc");
  let run = null, raf = 0, speed = 1;

  function buildRun() {
    const src = text.value.trim() ? text.value : SAMPLE;
    const meta = MD.parse(src, text.value.trim() ? S.format : "markdown");
    const seed = (Math.random() * 2 ** 31) | 0;
    const { events, total } = HT.plan(meta, active().params, seed);
    return { meta, events, total, idx: 0, vt: 0, due: events.length ? events[0].delay : 0,
      state: meta.length ? [{ type: meta[0].type, depth: meta[0].depth, chars: [] }] : [],
      playing: false, last: 0, fixes: 0, hist: [[0, 0]], progress: 0 };
  }
  function renderMock() {
    if (!run) return;
    let html = MD.render(run.state);
    const cursor = `<span class="cursor"></span>`;
    const i = html.lastIndexOf("</");
    html = i >= 0 ? html.slice(0, i) + cursor + html.slice(i) : cursor;
    mockDoc.innerHTML = html;
    mockDoc.scrollTop = mockDoc.scrollHeight;
    const pct = run.total ? Math.round((run.progress / run.total) * 100) : 0;
    $("#runPct").textContent = `${pct}%`;
    $("#runBar").style.width = `${pct}%`;
    $("#runFix").textContent = run.fixes;
    const h = run.hist, last = h[h.length - 1];
    let j = h.length - 1;
    while (j > 0 && last[0] - h[j][0] < 8) j--;
    const dt = last[0] - h[j][0];
    $("#runWpm").textContent = dt > 1 ? Math.round((last[1] - h[j][1]) / 5 / (dt / 60)) : "–";
  }
  function step(ts) {
    if (!run || !run.playing) return;
    run.vt += ((ts - run.last) / 1000) * speed;
    run.last = ts;
    let changed = false;
    while (run.idx < run.events.length && run.due <= run.vt) {
      const ev = run.events[run.idx];
      if (ev.op === "block") {
        const m = run.meta[ev.block];
        run.state.push({ type: m.type, depth: m.depth, chars: [] });
      } else if (ev.op === "char") run.state[run.state.length - 1].chars.push({ ch: ev.ch, styles: ev.styles });
      else if (ev.op === "bs") {
        run.state[run.state.length - 1].chars.pop();
        if (run.events[run.idx - 1]?.op !== "bs") run.fixes++;
      }
      run.progress = ev.progress;
      run.hist.push([run.due, ev.progress]);
      if (run.hist.length > 4000) run.hist.splice(0, 2000);
      run.idx++;
      if (run.idx < run.events.length) run.due += run.events[run.idx].delay;
      changed = true;
    }
    if (changed) renderMock();
    if (run.idx >= run.events.length) { run.playing = false; setPlay(false); $("#runPlay").textContent = "Replay"; return; }
    raf = requestAnimationFrame(step);
  }
  function setPlay(on) { $("#runPlay").textContent = on ? "Pause" : "Play"; }
  function play() {
    if (!run || run.idx >= run.events.length) { run = buildRun(); renderMock(); }
    run.playing = true; run.last = performance.now(); setPlay(true);
    raf = requestAnimationFrame(step);
  }
  function pauseRun() { if (run && run.playing) { run.playing = false; cancelAnimationFrame(raf); setPlay(false); } }
  function resetRun() {
    cancelAnimationFrame(raf);
    run = buildRun(); setPlay(false); renderMock();
  }
  $("#runPlay").addEventListener("click", () => (run && run.playing ? pauseRun() : play()));
  $("#runRestart").addEventListener("click", () => { resetRun(); play(); });
  $("#runSpeed").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    speed = +b.dataset.speed; setSeg($("#runSpeed"), "speed", b.dataset.speed);
  });

  // ------------------------------------------------------------------ init
  function onProfileChange() {
    renderProfiles(); renderTune(); renderCalData(); updateText(); resetRun();
    doneInRun = new Set(); startCal();
  }
  onProfileChange();
})();
