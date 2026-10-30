// Signed approval links, shared by the Trigger.dev tasks (which make them) and the Cloudflare
// Worker (which checks them). Web Crypto only, so the same code runs in Node and in Workers.

export const DECISIONS = ["approve", "reject", "done"] as const;
export type LinkDecision = (typeof DECISIONS)[number];

/** Trigger.dev environment the waiting run lives in; picks which secret key the relay uses. */
export type LinkEnv = "dev" | "staging" | "prod";

export type LinkPayload = {
  /** Waitpoint token tag: the relay completes whichever token is waiting under it. */
  t: string;
  /** The decision this link records. */
  d: LinkDecision;
  /** Who the link was sent to (recorded as "by"). */
  w: string;
  /** The question shown on the confirm page, e.g. "Approve GitHub access for Priya Shah?" */
  l: string;
  e: LinkEnv;
};

/** What the waiting task receives when someone confirms a link. */
export type DecisionOutput = { decision: LinkDecision; by: string; comment: string; at: string };

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

/** Query string for a link: `p` is the payload, `s` its signature. */
export async function signLink(secret: string, payload: LinkPayload): Promise<string> {
  const p = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return new URLSearchParams({ p, s: await hmac(secret, p) }).toString();
}

/** The payload if the signature matches, otherwise null. */
export async function verifyLink(secret: string, p: string, s: string): Promise<LinkPayload | null> {
  const expected = await hmac(secret, p);
  if (expected.length !== s.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ s.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(p))) as LinkPayload;
    if (!DECISIONS.includes(payload.d) || typeof payload.t !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
