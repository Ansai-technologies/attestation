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
  let redirectMode: string | undefined;

  globalThis.fetch = async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response(null, { status: 302 });
  };
  try {
    const [result] = await dispatch(store, COMPLETED, attestation);
    assert.equal(redirectMode, "manual");
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
