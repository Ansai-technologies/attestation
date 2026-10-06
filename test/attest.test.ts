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
import { issueAttestation } from "../lib/attest.js";
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
