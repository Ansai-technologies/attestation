/**
 * Persistence layer. Supabase (`attestations`, `webhooks` tables) is the
 * primary store; an in-memory store is provided for tests and local dev.
 *
 * The service throws a 503-style error when Supabase env vars are missing —
 * the API handlers surface that instead of silently running unbacked.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Attestation, Subject, WebhookEvent, WebhookRegistration } from "./types.js";

function toRow(att: Attestation, subject: Subject): Record<string, unknown> {
  return {
    id: att.id,
    type: att.type,
    subject_kind: subject.kind,
    subject_id: subject.id,
    payment_code: att.evidence?.transactionCode ?? null,
    order_ref: (att.evidence as Record<string, unknown>)?.orderRef ?? null,
    status: att.status,
    reason_code: att.reasonCode,
    reason: att.reason,
    evidence: att.evidence,
    signed_at: att.signedAt,
    signature: att.signature,
    prev_hash: att.prevHash,
    hash: att.hash,
  };
}

function fromRow(row: Record<string, unknown>): Attestation {
  return {
    id: row.id as string,
    type: row.type as Attestation["type"],
    status: row.status as Attestation["status"],
    reasonCode: row.reason_code as string,
    reason: row.reason as string,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    signedAt: (row.signed_at as string) ?? (row.created_at as string),
    signature: row.signature as string,
    prevHash: row.prev_hash as string,
    hash: row.hash as string,
  };
}

export class StorageUnavailableError extends Error {
  status = 503;
  constructor(msg = "Attestation store is not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)") {
    super(msg);
  }
}

export interface AttestationStore {
  latestHash(): Promise<string>;
  recentHashes(limit: number): Promise<Array<{ hash: string; prevHash: string }>>;
  findByHash(hash: string): Promise<Attestation | null>;
  recent(limit: number): Promise<Attestation[]>;
  insert(att: Attestation, subject: Subject): Promise<void>;
  getById(id: string): Promise<Attestation | null>;
  findByTransactionCode(code: string): Promise<Attestation[]>;
  findOpenByOrderRef(orderRef: string): Promise<Attestation | null>;
  appendCompletion(parentId: string, attestation: Attestation): Promise<Attestation | null>;
  registerWebhook(reg: WebhookRegistration): Promise<void>;
  listWebhooks(): Promise<WebhookRegistration[]>;
}

export class SupabaseStore implements AttestationStore {
  private client: SupabaseClient;
  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new StorageUnavailableError();
    this.client = createClient(url, key, { auth: { persistSession: false } });
  }

  async latestHash(): Promise<string> {
    const { data, error } = await this.client
      .from("attestations")
      .select("hash")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.hash as string) ?? "GENESIS";
  }
  async recentHashes(limit: number): Promise<Array<{ hash: string; prevHash: string }>> {
    const { data, error } = await this.client
      .from("attestations")
      .select("hash, prev_hash")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => ({ hash: r.hash as string, prevHash: r.prev_hash as string }));
  }
  async findByHash(hash: string): Promise<Attestation | null> {
    const { data, error } = await this.client
      .from("attestations")
      .select("*")
      .eq("hash", hash)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as Record<string, unknown>) : null;
  }
  async recent(limit: number): Promise<Attestation[]> {
    const { data, error } = await this.client
      .from("attestations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async insert(att: Attestation, subject: Subject): Promise<void> {
    const { error } = await this.client.from("attestations").insert(toRow(att, subject));
    if (error) throw error;
  }

  async getById(id: string): Promise<Attestation | null> {
    const { data, error } = await this.client.from("attestations").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as Record<string, unknown>) : null;
  }

  async findByTransactionCode(code: string): Promise<Attestation[]> {
    const { data, error } = await this.client.from("attestations").select("*").eq("payment_code", code);
    if (error) throw error;
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async findOpenByOrderRef(orderRef: string): Promise<Attestation | null> {
    const { data, error } = await this.client
      .from("attestations")
      .select("*")
      .eq("order_ref", orderRef)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as Record<string, unknown>) : null;
  }

  async appendCompletion(parentId: string, attestation: Attestation): Promise<Attestation | null> {
    const { data, error } = await this.client.rpc("append_attestation_completion", {
      p_parent_id: parentId,
      p_attestation: attestation,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? fromRow(row as Record<string, unknown>) : null;
  }

  async registerWebhook(reg: WebhookRegistration): Promise<void> {
    const { error } = await this.client.from("webhooks").insert({ url: reg.url, events: reg.events });
    if (error) throw error;
  }

  async listWebhooks(): Promise<WebhookRegistration[]> {
    const { data, error } = await this.client.from("webhooks").select("url, events").eq("active", true);
    if (error) throw error;
    return (data ?? []) as unknown as WebhookRegistration[];
  }
}

/** Non-persistent store for tests / local dev. */
export class InMemoryStore implements AttestationStore {
  private atts = new Map<string, Attestation>();
  private order: Attestation[] = [];
  private hooks: WebhookRegistration[] = [];

  async latestHash(): Promise<string> {
    const last = this.order[this.order.length - 1];
    return last ? last.hash : "GENESIS";
  }
  async recentHashes(limit: number): Promise<Array<{ hash: string; prevHash: string }>> {
    return this.order
      .slice(-limit)
      .reverse()
      .map((a) => ({ hash: a.hash, prevHash: a.prevHash }));
  }
  async findByHash(hash: string): Promise<Attestation | null> {
    return this.order.find((a) => a.hash === hash) ?? null;
  }
  async recent(limit: number): Promise<Attestation[]> {
    return this.order.slice(-limit).reverse();
  }
  async insert(att: Attestation, _subject: Subject): Promise<void> {
    this.atts.set(att.id, att);
    this.order.push(att);
  }
  async getById(id: string): Promise<Attestation | null> {
    return this.atts.get(id) ?? null;
  }
  async findByTransactionCode(code: string): Promise<Attestation[]> {
    return this.order.filter((a) => a.evidence?.transactionCode === code);
  }
  async findOpenByOrderRef(orderRef: string): Promise<Attestation | null> {
    return this.order.find((a) => a.evidence?.orderRef === orderRef && a.status === "pending") ?? null;
  }
  async appendCompletion(parentId: string, attestation: Attestation): Promise<Attestation | null> {
    const parent = this.atts.get(parentId);
    if (
      !parent ||
      parent.status !== "pending" ||
      attestation.evidence.supersedesAttestationId !== parentId ||
      this.order.some((entry) => entry.evidence.supersedesAttestationId === parentId)
    ) {
      return null;
    }
    this.atts.set(attestation.id, attestation);
    this.order.push(attestation);
    return attestation;
  }
  async registerWebhook(reg: WebhookRegistration): Promise<void> {
    this.hooks.push(reg);
  }
  async listWebhooks(): Promise<WebhookRegistration[]> {
    return [...this.hooks];
  }
}

/** Prefer Supabase when configured; tests may inject the in-memory store. */
let override: AttestationStore | null = null;
export function setStore(store: AttestationStore): void {
  override = store;
}
export function getStore(): AttestationStore {
  if (override) return override;
  return new SupabaseStore();
}
export function webhookSupported(_e: WebhookEvent): boolean {
  return true;
}
