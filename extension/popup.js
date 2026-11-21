const s = document.getElementById("s"), stop = document.getElementById("stop");
async function tick() {
  const r = await chrome.runtime.sendMessage({ cmd: "status" });
  const active = r.state === "typing" || r.state === "countdown";
  s.textContent = r.state === "typing" ? `Typing${r.profile ? " as " + r.profile : ""}… ${Math.round((100 * r.done) / Math.max(r.total, 1))}%`
    : r.message || { idle: "Idle — start from the website", done: "Done", stopped: "Stopped" }[r.state] || r.state;
  stop.disabled = !active;
}
stop.onclick = () => chrome.runtime.sendMessage({ cmd: "stop" }).then(tick);
tick(); setInterval(tick, 400);
