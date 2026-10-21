/**
 * GET /status (rewritten to /api/status) — public system status page.
 *
 * Cloudflare-style: overall banner plus per-component cards, refreshed from
 * /api/health every 30 seconds. Pure server-rendered HTML, no build step.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ansai Trust Engine &mdash; System Status</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2048%2048%22%3E%0A%20%20%3Ctitle%3EAttestation%20Engine%20%E2%80%94%20Ansai%3C%2Ftitle%3E%0A%20%20%3Ccircle%20cx%3D%2223%22%20cy%3D%2225%22%20r%3D%2214.5%22%20fill%3D%22none%22%20stroke%3D%22%2317222C%22%20stroke-width%3D%223.2%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M16%2025.5%20L21.5%2031%20L31.5%2019.5%22%20fill%3D%22none%22%20stroke%3D%22%232563EB%22%20stroke-width%3D%223.8%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2236.5%22%20cy%3D%2211.5%22%20r%3D%223.4%22%20fill%3D%22none%22%20stroke%3D%22%232563EB%22%20stroke-width%3D%222.8%22%2F%3E%0A%3C%2Fsvg%3E%0A">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; background: #f7f8fa; color: #1a1d21; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 60px; }
  .eyebrow { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #6b7280; margin: 0 0 6px; }
  h1 { font-size: 28px; margin: 0 0 6px; font-weight: 700; }
  .sub { color: #6b7280; margin: 0 0 24px; font-size: 15px; }
  .banner { border-radius: 12px; padding: 18px 22px; font-size: 17px; font-weight: 600; margin-bottom: 20px; border: 1px solid transparent; }
  .banner.ok { background: #e9f7ef; color: #157347; border-color: #bfe6cd; }
  .banner.bad { background: #fdeeee; color: #b42318; border-color: #f5c6c0; }
  .banner.loading { background: #eef1f4; color: #6b7280; border-color: #dde2e7; }
  .card { background: #fff; border: 1px solid #e5e8ec; border-radius: 12px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-bottom: 1px solid #eef0f3; }
  .row:last-child { border-bottom: none; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .dot.up { background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.15); }
  .dot.down { background: #ef4444; box-shadow: 0 0 0 4px rgba(239,68,68,.15); }
  .meta { flex: 1; min-width: 0; }
  .name { font-weight: 600; font-size: 15px; }
  .detail { color: #6b7280; font-size: 13px; margin-top: 2px; }
  .pill { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; flex: none; }
  .pill.up { background: #e9f7ef; color: #157347; }
  .pill.down { background: #fdeeee; color: #b42318; }
  .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; color: #6b7280; font-size: 13px; }
  button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #d4d9df; background: #fff; cursor: pointer; }
  button:hover { background: #f1f3f5; }
  .note { margin-top: 28px; font-size: 13px; color: #9aa0a8; }
  a { color: #2563eb; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">Ansai Trust Engine</p>
  <h1>System Status</h1>
  <p class="sub">Live health of the attestation infrastructure &mdash; refreshed automatically.</p>
  <div id="banner" class="banner loading">Checking&hellip;</div>
  <div class="card" id="components"></div>
  <div class="foot">
    <span id="updated">Last checked: &mdash;</span>
    <button onclick="refresh()">Refresh now</button>
  </div>
  <p class="note">Attestation infrastructure v0.1 &middot; API contract: <a href="/api/health">/api/health</a> (JSON)</p>
</div>
<script>
var ORDER = [["api","API"],["database","Database"],["signing","Signing"],["chain","Chain integrity"],["webhooks","Webhook auth"]];
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function render(data){
  var banner = el("banner");
  var ok = data && data.status === "operational";
  banner.className = "banner " + (ok ? "ok" : "bad");
  banner.textContent = ok ? "All Systems Operational" : "Degraded \u2014 one or more components need attention";
  var html = "";
  for (var i = 0; i < ORDER.length; i++){
    var key = ORDER[i][0], name = ORDER[i][1];
    var c = (data && data.components && data.components[key]) || { status: "down", detail: "no data" };
    var up = c.status === "up";
    html += '<div class="row">'
      + '<span class="dot ' + (up ? "up" : "down") + '"></span>'
      + '<div class="meta"><div class="name">' + name + '</div>'
      + '<div class="detail">' + esc(c.detail || "") + (c.latencyMs != null ? " \u00b7 " + c.latencyMs + " ms" : "") + "</div></div>"
      + '<span class="pill ' + (up ? "up" : "down") + '">' + (up ? "Operational" : "Down") + "</span>"
      + "</div>";
  }
  el("components").innerHTML = html;
  el("updated").textContent = "Last checked: " + new Date(data.checkedAt).toLocaleString();
}
function refresh(){
  fetch("/api/health").then(function(r){ return r.json(); }).then(render).catch(function(){
    var banner = el("banner");
    banner.className = "banner bad";
    banner.textContent = "Unreachable \u2014 could not contact the API";
    el("components").innerHTML = "";
    el("updated").textContent = "Last checked: " + new Date().toLocaleString();
  });
}
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(PAGE);
}
