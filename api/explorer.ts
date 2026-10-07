/**
 * GET /explorer (rewritten to /api/explorer) — attestation explorer.
 *
 * Look up any attestation by ID, see the server-verified signature badge,
 * walk the hash chain backwards via prevHash, and browse recent records.
 * Read-only; verification is public by design.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attestation Explorer &mdash; Ansai Trust Engine</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; background: #f7f8fa; color: #1a1d21; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 60px; }
  .eyebrow { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #6b7280; margin: 0 0 6px; }
  h1 { font-size: 28px; margin: 0 0 6px; font-weight: 700; }
  .sub { color: #6b7280; margin: 0 0 24px; font-size: 15px; }
  .search { display: flex; gap: 10px; margin-bottom: 24px; }
  input { flex: 1; font: inherit; font-size: 14px; padding: 10px 14px; border-radius: 8px; border: 1px solid #d4d9df; }
  button { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 8px; border: 1px solid #d4d9df; background: #fff; cursor: pointer; white-space: nowrap; }
  button:hover { background: #f1f3f5; }
  button.primary { background: #1a1d21; color: #fff; border-color: #1a1d21; }
  button.primary:hover { background: #33373d; }
  .card { background: #fff; border: 1px solid #e5e8ec; border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
  .cardhead { padding: 16px 20px; border-bottom: 1px solid #eef0f3; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pill { font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px; text-transform: uppercase; letter-spacing: .5px; }
  .pill.verified { background: #e9f7ef; color: #157347; }
  .pill.unverified { background: #fdf3e7; color: #b45309; }
  .pill.pending { background: #eef2ff; color: #4338ca; }
  .sig { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; }
  .sig.ok { background: #e9f7ef; color: #157347; }
  .sig.bad { background: #fdeeee; color: #b42318; }
  .fields { padding: 8px 20px 16px; }
  .frow { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f2f4f6; font-size: 14px; }
  .frow:last-child { border-bottom: none; }
  .fkey { width: 130px; flex: none; color: #6b7280; font-weight: 600; font-size: 13px; }
  .fval { flex: 1; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  pre { background: #f7f8fa; border: 1px solid #eef0f3; border-radius: 8px; padding: 12px; font-size: 13px; overflow-x: auto; margin: 4px 0 0; }
  a { color: #2563eb; text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  .list { padding: 0; }
  .lrow { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #eef0f3; font-size: 14px; }
  .lrow:last-child { border-bottom: none; }
  .lrow:hover { background: #fafbfc; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .dot.verified { background: #22c55e; } .dot.unverified { background: #f59e0b; } .dot.pending { background: #6366f1; }
  .lid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .ltime { margin-left: auto; color: #9aa0a8; font-size: 12px; flex: none; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  .err { background: #fdeeee; color: #b42318; border: 1px solid #f5c6c0; border-radius: 8px; padding: 12px 16px; font-size: 14px; margin-bottom: 20px; }
  .hint { color: #9aa0a8; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">Ansai Trust Engine</p>
  <h1>Attestation Explorer</h1>
  <p class="sub">Look up any record, check its signature, walk the tamper-evident chain.</p>
  <div class="search">
    <input id="q" placeholder="Paste an attestation ID, e.g. att_6193d2231d124080be02b6d9" onkeydown="if(event.key==='Enter')lookup()">
    <button class="primary" onclick="lookup()">Look up</button>
  </div>
  <div id="err"></div>
  <div id="detail"></div>
  <h2>Recent attestations</h2>
  <div class="card"><div class="list" id="recent"><div class="lrow"><span class="hint">Loading&hellip;</span></div></div></div>
</div>
<script>
function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function short(s){ s = String(s); return s.length > 24 ? s.slice(0, 12) + "\u2026" + s.slice(-8) : s; }
function pill(status){
  var cls = status === "verified" ? "verified" : status === "pending" ? "pending" : "unverified";
  return '<span class="pill ' + cls + '">' + esc(status) + "</span>";
}
function field(k, v, mono){
  return '<div class="frow"><div class="fkey">' + k + '</div><div class="fval' + (mono ? " mono" : "") + '">' + v + "</div></div>";
}
function renderDetail(a){
  var sig = a.verified
    ? '<span class="sig ok">\u2713 signature valid</span>'
    : '<span class="sig bad">\u2717 signature INVALID</span>';
  var prev = a.prevHash === "GENESIS"
    ? '<span class="hint">Genesis \u2014 first record in the chain</span>'
    : '<a onclick="loadByHash(\'' + esc(a.prevHash) + '\')">\u2190 ' + esc(short(a.prevHash)) + "</a>";
  var ev = esc(JSON.stringify(a.evidence, null, 2));
  document.getElementById("detail").innerHTML =
    '<div class="card"><div class="cardhead">' + pill(a.status) + sig
    + '<span class="mono" style="margin-left:auto">' + esc(a.id) + "</span></div>"
    + '<div class="fields">'
    + field("Type", esc(a.type))
    + field("Reason", esc(a.reasonCode) + ' <span class="hint">' + esc(a.reason) + "</span>")
    + field("Hash", esc(a.hash), true)
    + field("Previous", prev)
    + field("Signed at", esc(new Date(a.signedAt).toLocaleString()))
    + field("Signature", esc(short(a.signature)), true)
    + field("Evidence", "<pre>" + ev + "</pre>")
    + "</div></div>";
  document.getElementById("err").innerHTML = "";
  window.scrollTo(0, 0);
}
function showErr(msg){
  document.getElementById("err").innerHTML = '<div class="err">' + esc(msg) + "</div>";
}
function loadById(id){
  fetch("/api/attestations/" + encodeURIComponent(id)).then(function(r){
    if (!r.ok) throw new Error(r.status === 404 ? "No attestation with that ID." : "Lookup failed (HTTP " + r.status + ").");
    return r.json();
  }).then(renderDetail).catch(function(e){ showErr(e.message); });
}
function loadByHash(hash){
  fetch("/api/attestations?hash=" + encodeURIComponent(hash)).then(function(r){
    if (!r.ok) throw new Error("Record not found.");
    return r.json();
  }).then(renderDetail).catch(function(e){ showErr(e.message); });
}
function lookup(){
  var q = document.getElementById("q").value.trim();
  if (q) loadById(q);
}
function loadRecent(){
  fetch("/api/attestations?limit=10").then(function(r){ return r.json(); }).then(function(j){
    var rows = j.attestations || [];
    if (!rows.length){
      document.getElementById("recent").innerHTML = '<div class="lrow"><span class="hint">No attestations yet.</span></div>';
      return;
    }
    var html = "";
    for (var i = 0; i < rows.length; i++){
      var a = rows[i];
      html += '<div class="lrow"><span class="dot ' + esc(a.status) + '"></span>'
        + '<a class="lid" onclick="loadById(\'' + esc(a.id) + '\')">' + esc(a.id) + "</a>"
        + '<span class="hint">' + esc(a.type) + " \u00b7 " + esc(a.reasonCode) + "</span>"
        + '<span class="ltime">' + esc(new Date(a.signedAt).toLocaleString()) + "</span></div>";
    }
    document.getElementById("recent").innerHTML = html;
  }).catch(function(){
    document.getElementById("recent").innerHTML = '<div class="lrow"><span class="hint">Could not load recent records.</span></div>';
  });
}
loadRecent();
</script>
</body>
</html>`;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(PAGE);
}
