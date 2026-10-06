/**
 * Chain + signature tests (in-memory store; no Supabase, no Daraja).
 * Run: npm test  →  tsc && node --test dist/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const kp = generateKeyPairSync("ed25519");
process.env.ED25519_PRIVATE_KEY_PEM = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.ED25519_PUBLIC_KEY_PEM = kp.publicKey.export({ type: "spki", format: "pem" }) as string;

import { InMemoryStore } from "../lib/store.js";
import { completeAttestation, issueAttestation } from "../lib/attest.js";
import { verifyAttestation } from "../lib/sign.js";

test("issues a hash-chained, verifiable attestation", async () => {
  const store = new InMemoryStore();
  const subject = { kind: "person" as const, id: "buyer-1" };

  const first = await issueAttestation(store, subject, {
    type: "record",
    status: "verified",
    reasonCode: "VERIFIED",
    reason: "first",
    evidence: { hash: "sha256:abc" },
  });
  assert.equal(first.prevHash, "GENESIS");
  assert.ok(first.id.startsWith("att_"));
  assert.ok(verifyAttestation(first));

  const second = await issueAttestation(store, subject, {
    type: "record",
    status: "verified",
    reasonCode: "VERIFIED",
    reason: "second",
    evidence: { hash: "sha256:def" },
  });
  assert.equal(second.prevHash, first.hash);
  assert.ok(verifyAttestation(second));

  const fetched = await store.getById(first.id);
  assert.ok(fetched && verifyAttestation(fetched));
});

test("tampering breaks verification", async () => {
  const store = new InMemoryStore();
  const att = await issueAttestation(store, { kind: "person", id: "x" }, {
    type: "record",
    status: "verified",
    reasonCode: "VERIFIED",
    reason: "original",
    evidence: {},
  });
  const tampered = { ...att, reason: "edited by attacker" };
  assert.equal(verifyAttestation(tampered), false);
});

test("completes a pending attestation by appending one linked chain entry", async () => {
  const store = new InMemoryStore();
  const pending = await issueAttestation(store, { kind: "person", id: "buyer-2" }, {
    type: "payment",
    status: "pending",
    reasonCode: "PENDING_CALLBACK",
    reason: "awaiting callback",
    evidence: { orderRef: "order-2" },
  });
  const intervening = await issueAttestation(store, { kind: "person", id: "buyer-3" }, {
    type: "record",
    status: "verified",
    reasonCode: "VERIFIED",
    reason: "intervening",
    evidence: {},
  });

  const results = await Promise.all([
    completeAttestation(store, pending, {
      status: "verified",
      reasonCode: "MATCHED",
      reason: "payment matched",
      evidence: { orderRef: "order-2" },
    }),
    completeAttestation(store, pending, {
      status: "verified",
      reasonCode: "MATCHED",
      reason: "duplicate callback",
      evidence: { orderRef: "order-2" },
    }),
  ]);
  const completed = results.find((result) => result !== null);

  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(completed);
  assert.notEqual(completed.id, pending.id);
  assert.equal(completed.prevHash, intervening.hash);
  assert.equal(completed.evidence.supersedesAttestationId, pending.id);
  assert.ok(verifyAttestation(pending));
  assert.ok(verifyAttestation(completed));
  assert.equal((await store.getById(pending.id))?.status, "pending");
});
