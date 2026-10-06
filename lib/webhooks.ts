/**
 * Webhook dispatcher. Fires `attestation.completed` / `attestation.failed`
 * to every registered callback URL for that event. One retry on failure;
 * failures are logged, never thrown — dispatch must not break attestation.
 */
import type { Attestation, WebhookEvent, WebhookRegistration } from "./types.js";
import type { AttestationStore } from "./store.js";
import { isIP } from "node:net";

export const COMPLETED: WebhookEvent = "attestation.completed";
export const FAILED: WebhookEvent = "attestation.failed";

export function eventFor(status: Attestation["status"]): WebhookEvent | null {
  if (status === "verified") return COMPLETED;
  if (status === "unverified") return FAILED;
  return null; // pending attestations don't dispatch
}

/**
 * Registration-time destination policy (SSRF guard, v0.1).
 * - `localhost` / 127.x / ::1: http or https (local dev).
 * - Anything else: https only, and no private/loopback/link-local literals.
 * Known limitation: DNS names are validated at registration time only —
 * DNS rebinding between registration and dispatch is not mitigated in v0.1.
 */
export function webhookUrlAllowed(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  const host = u.hostname.toLowerCase();
  const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const isLocal = address === "localhost" || address === "::1" || /^127\./.test(address);
  if (u.protocol !== "https:" && !(isLocal && u.protocol === "http:")) {
    return { ok: false, reason: "https required (http is allowed only for localhost)" };
  }
  if (!isLocal && isPrivateHost(address)) {
    return { ok: false, reason: "private/loopback/link-local destinations are not allowed" };
  }
  return { ok: true };
}

function isPrivateHost(host: string): boolean {
  if (/^127\./.test(host)) return true;
  if (/^(10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (isIP(host) === 6) {
    const address = ipv6Value(host);
    if (address === null) return false;
    if (address === 0n || address === 1n) return true;
    if (inIpv6Range(address, 0xfc00n << 112n, 7) || inIpv6Range(address, 0xfe80n << 112n, 10)) {
      return true;
    }
    if (address >> 32n === 0xffffn && isPrivateHost(ipv4FromNumber(Number(address & 0xffffffffn)))) {
      return true;
    }
  }
  return false; // DNS names pass here (see rebinding limitation above)
}

function ipv6Value(host: string): bigint | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...left, ...Array(zeroCount).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Range(address: bigint, base: bigint, prefixLength: number): boolean {
  const rangeSize = 1n << BigInt(128 - prefixLength);
  return address >= base && address < base + rangeSize;
}

function ipv4FromNumber(address: number): string {
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 255).join(".");
}

export async function registerWebhook(
  store: AttestationStore,
  reg: WebhookRegistration,
): Promise<void> {
  const check = webhookUrlAllowed(reg.url);
  if (!check.ok) throw new Error(`url rejected: ${check.reason}`);
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
        redirect: "manual",
      });
      if (res.ok) return { url, ok: true, status: res.status };
    } catch (e) {
      if (attempt === 1) return { url, ok: false, error: String(e) };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { url, ok: false, error: "non-2xx response" };
}
