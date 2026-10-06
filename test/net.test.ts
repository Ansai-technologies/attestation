import { test } from "node:test";
import assert from "node:assert/strict";
import { allowlistAllows, callerIp } from "../lib/net.js";
import { parseDarajaTransTime } from "../lib/daraja.js";

test("caller IP uses Vercel's trusted header, not client-controlled forwarding", () => {
  assert.equal(
    callerIp({
      headers: {
        "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1",
        "x-forwarded-for": "198.51.100.7",
      },
    }),
    "203.0.113.8",
  );
  assert.equal(callerIp({ headers: { "x-forwarded-for": "198.51.100.7" } }), "");
});

test("an empty callback allowlist denies access", () => {
  assert.equal(allowlistAllows("", "203.0.113.8"), false);
  assert.equal(allowlistAllows("203.0.113.0/24", "203.0.113.8"), true);
});

test("Daraja transaction times are parsed as East Africa Time", () => {
  assert.equal(
    parseDarajaTransTime("20260102123456").toISOString(),
    "2026-01-02T09:34:56.000Z",
  );
  assert.ok(Number.isNaN(parseDarajaTransTime("invalid").getTime()));
});
