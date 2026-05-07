import https from "https";
import path from "path";

export function workspaceName(ws) {
  if (!ws) return "(no-workspace)";
  return path.basename(ws) || ws;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtDurationMin(ms) {
  const totalMin = ms / 60000;
  if (totalMin < 1) return `${Math.round(ms / 1000)}s`;
  return `${totalMin.toFixed(2)} phút`;
}

export function sendTelegram({ token, chatId, message }) {
  if (!token || !chatId) return Promise.resolve({ ok: false, error: "missing token or chatId" });
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: 10000,
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(data);
    req.end();
  });
}
