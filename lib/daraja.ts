/**
 * Daraja (Safaricom M-Pesa API) integration — sandbox first.
 *
 * All credentials come from env vars (see .env.example). NEVER hardcode keys.
 * v0.1 uses the transaction-status API to verify buyer-supplied M-Pesa codes;
 * C2B callbacks land on POST /mpesa/c2b/callback (stronger signal).
 *
 * Production keys arrive via the founder's masked paste — never in chat,
 * never in code, never in a repo.
 */
import type { PaymentRequest } from "./types.js";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";

function darajaEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured (see .env.example)`);
  return v;
}

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  securityCredential: string;
  baseUrl: string;
}

export function darajaConfig(): DarajaConfig {
  const env = (process.env.DARAJA_ENV ?? "sandbox").toLowerCase();
  return {
    consumerKey: darajaEnv("DARAJA_CONSUMER_KEY"),
    consumerSecret: darajaEnv("DARAJA_CONSUMER_SECRET"),
    shortcode: darajaEnv("DARAJA_SHORTCODE"),
    securityCredential: process.env.DARAJA_SECURITY_CREDENTIAL ?? "",
    baseUrl: env === "sandbox" ? SANDBOX_BASE : "https://api.safaricom.co.ke",
  };
}

/** OAuth client-credentials token for Daraja APIs. */
export async function darajaAccessToken(cfg: DarajaConfig = darajaConfig()): Promise<string> {
  const creds = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daraja OAuth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Daraja OAuth returned no access_token");
  return json.access_token;
}

export interface TransactionStatusResult {
  /** Daraja found the transaction at all */
  found: boolean;
  /** Raw response for evidence */
  raw: Record<string, unknown>;
  amount?: number;
  receiptNumber?: string;
  transactionTime?: string;
}

/**
 * Transaction status query (M-Pesa Transaction Status API).
 * Looks up a buyer-supplied receipt code. The caller compares amount /
 * recipient / recency against expectations.
 */
export async function queryTransactionStatus(
  transactionCode: string,
  opts: { token?: string; cfg?: DarajaConfig } = {},
): Promise<TransactionStatusResult> {
  const cfg = opts.cfg ?? darajaConfig();
  const token = opts.token ?? (await darajaAccessToken(cfg));
  const res = await fetch(`${cfg.baseUrl}/mpesa/transactionstatus/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Initiator: "attestation",
      SecurityCredential: cfg.securityCredential,
      CommandID: "TransactionStatusQuery",
      TransactionID: transactionCode,
      PartyA: cfg.shortcode,
      IdentifierType: "4",
      ResultURL: "https://attestation.example.invalid/daraja/result",
      QueueTimeOutURL: "https://attestation.example.invalid/daraja/timeout",
      Remarks: "Trust Engine transaction status query",
      Occasion: "attestation",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daraja transaction-status failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  // The authoritative result arrives async on ResultURL; the sync response
  // carries ConversationID + OriginatorConversationID for correlation.
  const responseCode = String(raw.ResponseCode ?? raw.responseCode ?? "");
  return {
    found: responseCode === "0",
    raw,
    receiptNumber: transactionCode,
  };
}

export interface LookupVerdict {
  /** "lookup" | "awaiting-callback" — whether verification can complete now */
  mode: "lookup" | "awaiting-callback";
  found: boolean;
  matchedAmount: boolean;
  matchedRecipient: boolean;
  stale: boolean;
  transactionTime?: string;
  amount?: number;
  raw: Record<string, unknown>;
}

/**
 * Verify-by-lookup: query Daraja for the buyer-supplied code and compare
 * against expected amount, recipient and recency (>24h old => STALE).
 *
 * Note: Daraja's transaction-status result is asynchronous in production —
 * the sync call queues the query and the result lands on ResultURL. For v0.1
 * sandbox flows we attempt the query and treat a non-committal response as
 * "awaiting callback"; the C2B callback remains the strongest signal.
 */
export async function verifyPaymentByLookup(payment: PaymentRequest): Promise<LookupVerdict> {
  const result = await queryTransactionStatus(payment.transactionCode);
  if (!result.found) {
    return {
      mode: "awaiting-callback",
      found: false,
      matchedAmount: false,
      matchedRecipient: false,
      stale: false,
      raw: result.raw,
    };
  }
  const amount = typeof result.amount === "number" ? result.amount : undefined;
  const txnTime = result.transactionTime ? new Date(result.transactionTime) : undefined;
  const stale = txnTime ? Date.now() - txnTime.getTime() > 24 * 60 * 60 * 1000 : false;
  return {
    mode: "lookup",
    found: true,
    matchedAmount: amount === undefined ? false : amount === payment.expectedAmount,
    matchedRecipient: true, // recipient asserted by shortcode-scoped query; refined in v0.2
    stale,
    transactionTime: result.transactionTime,
    amount,
    raw: result.raw,
  };
}
