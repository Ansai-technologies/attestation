import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPLETED, dispatch, webhookUrlAllowed } from "../lib/webhooks.js";
import type { Attestation, WebhookRegistration } from "../lib/types.js";
import type { AttestationStore } from "../lib/store.js";

test("allows local HTTP destinations, including bracketed IPv6 localhost", () => {
  assert.equal(webhookUrlAllowed("http://localhost/hook").ok, true);
  assert.equal(webhookUrlAllowed("http://[::1]/hook").ok, true);
  assert.equal(webhookUrlAllowed("https://[::1]/hook").ok, true);
});

test("requires HTTP or HTTPS even for localhost", () => {
  assert.equal(webhookUrlAllowed("file://localhost/path").ok, false);
});

test("allows globally routable IPv6 HTTPS destinations", () => {
  assert.equal(webhookUrlAllowed("https://[2606:4700:4700::1111]/hook").ok, true);
});

test("rejects unspecified, private, mapped-loopback, and link-local IPv6 destinations", () => {
  for (const url of [
    "https://[::]/hook",
    "https://[fc00::1]/hook",
    "https://[fe80::1]/hook",
    "https://[::ffff:192.168.1.1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
  ]) {
    assert.equal(webhookUrlAllowed(url).ok, false, url);
  }
});

test("does not follow webhook redirects", async () => {
  const registration: WebhookRegistration = { url: "https://hooks.example/hook", events: [COMPLETED] };
  const store = {
    listWebhooks: async () => [registration],
  } as unknown as AttestationStore;
  const attestation = {} as Attestation;
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.ATTESTATION_WEBHOOK_SECRET;
  let redirectMode: string | undefined;
  let signature: string | undefined;

  globalThis.fetch = async (_input, init) => {
    redirectMode = init?.redirect;
    signature = (init?.headers as Record<string, string>)["X-Tuma-Signature"];
    return new Response(null, { status: 302 });
  };
  process.env.ATTESTATION_WEBHOOK_SECRET = "test-webhook-secret";
  try {
    const [result] = await dispatch(store, COMPLETED, attestation);
    assert.equal(redirectMode, "manual");
    assert.equal(signature, "d7cc55d7e4b30a3aea890d7c56af5f3b5510c54f56dec25b0439ce5d168d4640");
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.ATTESTATION_WEBHOOK_SECRET;
    else process.env.ATTESTATION_WEBHOOK_SECRET = originalSecret;
  }
});

test("logs missing webhook secret once per dispatch", async () => {
  const registrations: WebhookRegistration[] = [
    { url: "https://hooks.example/one", events: [COMPLETED] },
    { url: "https://hooks.example/two", events: [COMPLETED] },
  ];
  const store = {
    listWebhooks: async () => registrations,
  } as unknown as AttestationStore;
  const originalSecret = process.env.ATTESTATION_WEBHOOK_SECRET;
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  delete process.env.ATTESTATION_WEBHOOK_SECRET;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const results = await dispatch(store, COMPLETED, {} as Attestation);
    assert.equal(results.length, 2);
    assert.ok(results.every((result) => !result.ok && result.error?.includes("not configured")));
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /ATTESTATION_WEBHOOK_SECRET is not configured/);
  } finally {
    console.error = originalConsoleError;
    if (originalSecret === undefined) delete process.env.ATTESTATION_WEBHOOK_SECRET;
    else process.env.ATTESTATION_WEBHOOK_SECRET = originalSecret;
  }
});
