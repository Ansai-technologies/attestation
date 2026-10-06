/**
 * POST /webhooks — register a callback URL for attestation.completed /
 * attestation.failed events. Payload delivered: { event, attestation }.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore, StorageUnavailableError } from "../../lib/store.js";
import { registerWebhook } from "../../lib/webhooks.js";
import type { WebhookEvent } from "../../lib/types.js";

const EVENTS: WebhookEvent[] = ["attestation.completed", "attestation.failed"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const { url, events } = (req.body ?? {}) as { url?: unknown; events?: unknown };

  if (typeof url !== "string" || !/^https?:\/\/\S+$/.test(url)) {
    return res.status(400).json({ error: "url must be an http(s) URL" });
  }
  const evts = Array.isArray(events) ? events : [];
  if (evts.length === 0 || !evts.every((e) => EVENTS.includes(e))) {
    return res.status(400).json({ error: `events must be a non-empty subset of ${EVENTS.join(", ")}` });
  }

  let store;
  try {
    store = getStore();
  } catch (e) {
    if (e instanceof StorageUnavailableError)
      return res.status(e.status).json({ error: e.message });
    throw e;
  }

  try {
    await registerWebhook(store, { url, events: evts as WebhookEvent[] });
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  return res.status(201).json({ url, events: evts, status: "registered" });
}
