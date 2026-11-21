// Press Esc inside the Google Doc to stop typing immediately.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && e.isTrusted) chrome.runtime.sendMessage({ cmd: "stop" }).catch(() => {});
}, true);
