/** GET /attestations/{id} — retrieve an attestation. Anyone can re-verify the signature. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore, StorageUnavailableError } from "../../lib/store.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: "missing attestation id" });

  let store;
  try {
    store = getStore();
  } catch (e) {
    if (e instanceof StorageUnavailableError)
      return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const att = await store.getById(id);
  if (!att) return res.status(404).json({ error: `attestation ${id} not found` });
  return res.status(200).json(att);
}
