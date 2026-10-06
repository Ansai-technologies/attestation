/**
 * Webhook dispatcher. Fires `attestation.completed` / `attestation.failed`
 * to every registered callback URL for that event. One retry on failure;
 * failures are logged, never thrown — dispatch must not break attestation.
 */
import type { Attestation, WebhookEvent, WebhookRegistration } from "./types.js";
import type { AttestationStore } from "./store.js";

export const COMPLETED: WebhookEvent = "attestation.completed";
export const FAILED: WebhookEvent = "attestation.failed";

export function eventFor(status: Attestation["status"]): WebhookEvent | null {
  if (status === "verified") return COMPLETED;
  if (status === "unverified") return FAILED;
  return null; // pending attestations don't dispatch
}

export async function registerWebhook(
  store: AttestationStore,
  reg: WebhookRegistration,
): Promise<void> {
  if (!/^https?:\/\/\S+$/.test(reg.url)) throw new Error("url must be an http(s) URL");
  if (!reg.events || reg.events.length === 0) throw new Error("at least one event is required");
  await store.registerWebhook(reg);
}

export interface DispatchResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

/** Fire event to all matching webhooks; resolves with per-URL results. */
export async function dispatch(
  store: AttestationStore,
  event: WebhookEvent,
  attestation: Attestation,
): Promise<DispatchResult[]> {
  const hooks: WebhookRegistration[] = (await store.listWebhooks()).filter((h) =>
    h.events.includes(event),
  );
  return Promise.all(hooks.map((h) => postWithRetry(h.url, event, attestation)));
}

async function postWithRetry(
  url: string,
  event: WebhookEvent,
  attestation: Attestation,
): Promise<DispatchResult> {
  const body = JSON.stringify({ event, attestation });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Attestation-Event": event },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { url, ok: true, status: res.status };
    } catch (e) {
      if (attempt === 1) return { url, ok: false, error: String(e) };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { url, ok: false, error: "non-2xx response" };
}
