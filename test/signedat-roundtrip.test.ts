/**
 * Regression test: Supabase returns timestamptz as "+00:00", but signatures are
 * computed over the Z-form ISO string at issuance. fromRow must normalize so
 * database round-trips verify byte-identically — otherwise every DB-backed
 * read fails verification (caught live by the explorer, 2026-10-07).
 * Run: npm test  →  tsc && node --test dist/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const kp = generateKeyPairSync("ed25519");
process.env.ED25519_PRIVATE_KEY_PEM = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.ED25519_PUBLIC_KEY_PEM = kp.publicKey.export({ type: "spki", format: "pem" }) as string;

import { fromRow, InMemoryStore } from "../lib/store.js";
import { issueAttestation } from "../lib/attest.js";
import { verifyAttestation } from "../lib/sign.js";

test("Supabase timestamptz round-trip preserves verifiability", async () => {
  const store = new InMemoryStore();
  const att = await issueAttestation(store, { kind: "business", id: "acme" }, {
    type: "record",
    status: "verified",
    reasonCode: "VERIFIED",
    reason: "sealed",
    evidence: { hash: "sha256:abc", recordedBy: "t" },
  });
  assert.ok(verifyAttestation(att));

  // Simulate what Postgres does: timestamptz comes back as +00:00, not Z.
  const pgStyleRow = {
    id: att.id,
    type: att.type,
    subject_kind: "business",
    subject_id: "acme",
    payment_code: null,
    order_ref: null,
    status: att.status,
    reason_code: att.reasonCode,
    reason: att.reason,
    evidence: att.evidence,
    signed_at: att.signedAt.replace("Z", "+00:00"),
    created_at: att.signedAt.replace("Z", "+00:00"),
    signature: att.signature,
    prev_hash: att.prevHash,
    hash: att.hash,
  };
  const back = fromRow(pgStyleRow);
  assert.equal(back.signedAt, att.signedAt);
  assert.ok(verifyAttestation(back), "attestation must verify after a database round-trip");
});
