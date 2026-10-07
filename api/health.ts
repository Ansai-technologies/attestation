/**
 * GET /api/health — public, read-only liveness probe for the status page.
 *
 * Checks each subsystem independently and reports per-component status so a
 * single failure names itself. Writes nothing. Exposes no secret material:
 * the webhook check only reports whether the admin secret is configured.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore, StorageUnavailableError } from "../lib/store.js";
import { signingReady } from "../lib/sign.js";

type ComponentStatus = { status: "up" | "down"; latencyMs?: number; detail?: string };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const started = Date.now();
  const components: Record<string, ComponentStatus> = {};
  let degraded = false;

  // Signing: full sign+verify round-trip with the configured keypair.
  const s = signingReady();
  components.signing = s.ok
    ? { status: "up", detail: s.detail }
    : { status: "down", detail: s.detail };
  if (!s.ok) degraded = true;

  // Webhook auth: configured or not (never leaks the secret itself).
  const webhookSecret = process.env.WEBHOOK_ADMIN_SECRET;
  components.webhooks = webhookSecret
    ? { status: "up", detail: "admin secret configured" }
    : { status: "down", detail: "WEBHOOK_ADMIN_SECRET is not configured" };
  if (!webhookSecret) degraded = true;

  // Database + hash-chain integrity (read-only).
  try {
    const store = getStore();
    const t0 = Date.now();
    const rows = await store.recentHashes(10);
    const latencyMs = Date.now() - t0;
    let chainOk = true;
    for (let i = 0; i + 1 < rows.length; i++) {
      if (rows[i].prevHash !== rows[i + 1].hash) {
        chainOk = false;
        break;
      }
    }
    components.database = {
      status: "up",
      latencyMs,
      detail: rows.length === 0 ? "connected, no attestations yet" : `connected, ${rows.length} recent records read`,
    };
    components.chain = chainOk
      ? {
          status: "up",
          detail: rows.length === 0 ? "nothing to link yet" : `${rows.length} recent records link correctly`,
        }
      : { status: "down", detail: "hash chain break detected in recent records" };
    if (!chainOk) degraded = true;
  } catch (e) {
    const detail =
      e instanceof StorageUnavailableError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    components.database = { status: "down", detail };
    components.chain = { status: "down", detail: "cannot verify without database" };
    degraded = true;
  }

  components.api = {
    status: "up",
    latencyMs: Date.now() - started,
    detail: "health endpoint responding",
  };

  const status = degraded ? "degraded" : "operational";
  return res.status(degraded ? 503 : 200).json({
    status,
    checkedAt: new Date().toISOString(),
    components,
  });
}
