/**
 * Minimal network helpers for source authentication (no dependencies).
 * v0.1 scope: IPv4 only. An IPv6 caller never matches a v4 allowlist entry.
 */

/** Dotted IPv4 → uint32, or null when not a valid IPv4 address. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

/** True when `ip` falls inside `cidr` ("203.0.113.7" or "203.0.113.0/24"). */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const baseInt = ipv4ToInt(base);
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null) return false;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (baseInt & mask) === (ipInt & mask);
}

/** Vercel-authenticated client IP, or the socket address outside Vercel. */
export function callerIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-vercel-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = (raw ?? "").split(",")[0].trim();
  return first || req.socket?.remoteAddress?.trim() || "";
}

/**
 * Allowlist gate. A blank allowlist always denies; configured entries are
 * comma-separated IPs/CIDRs.
 */
export function allowlistAllows(allowlist: string, ip: string): boolean {
  if (!allowlist.trim()) return false;
  return allowlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => cidrContains(entry, ip));
}
