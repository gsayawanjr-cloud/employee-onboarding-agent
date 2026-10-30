// Cloudflare Worker: turns a click on an emailed Approve / Reject / Mark done link into a completed
// Trigger.dev wait. Opening a link only shows a confirm page; the button press (a POST) records the
// decision, so email scanners that pre-open links can't approve anything.
import { type DecisionOutput, type LinkEnv, verifyLink } from "./link.js";

type Env = {
  APPROVAL_LINK_SECRET: string;
  TRIGGER_DEV_SECRET_KEY?: string;
  TRIGGER_STAGING_SECRET_KEY?: string;
  TRIGGER_PROD_SECRET_KEY?: string;
  TRIGGER_API_URL?: string;
};

const VERBS = { approve: "Approve", reject: "Reject", done: "Mark done" } as const;
const COLORS = { approve: "#1E7B4A", reject: "#B3261E", done: "#1F3864" } as const;

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#F3F6FB;color:#1F1F1F;margin:0;padding:32px 16px}
main{max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:20px;color:#1F3864;margin:0 0 12px}p{line-height:1.5}textarea{width:100%;box-sizing:border-box;min-height:80px;font:inherit;padding:8px;border:1px solid #C9CFD8;border-radius:6px}
button{border:0;color:#fff;font-size:16px;padding:12px 22px;border-radius:6px;cursor:pointer;margin-top:14px}.muted{color:#666;font-size:13px}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function secretKey(env: Env, e: LinkEnv): string | undefined {
  return { dev: env.TRIGGER_DEV_SECRET_KEY, staging: env.TRIGGER_STAGING_SECRET_KEY, prod: env.TRIGGER_PROD_SECRET_KEY }[e];
}

/** Completes the token waiting under `tag`. A new token is created at each reminder, so retry briefly if we land in that gap. */
async function completeWaiting(env: Env, e: LinkEnv, tag: string, output: DecisionOutput): Promise<"done" | "none"> {
  const key = secretKey(env, e);
  if (!key) throw new Error(`No Trigger.dev secret key set for the "${e}" environment`);
  const api = env.TRIGGER_API_URL ?? "https://api.trigger.dev";
  for (let attempt = 0; attempt < 4; attempt++) {
    const params = new URLSearchParams({ "filter[status]": "WAITING", "filter[tags]": tag });
    const list = await fetch(`${api}/api/v1/waitpoints/tokens?${params}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!list.ok) throw new Error(`Trigger.dev API ${list.status}`);
    const tokens = ((await list.json()) as { data?: { url: string }[] }).data ?? [];
    if (tokens.length > 0) {
      for (const token of tokens) {
        const done = await fetch(token.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(output) });
        if (!done.ok) throw new Error(`Trigger.dev callback ${done.status}`);
      }
      return "done";
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "none";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/a") return page("Onboarding approvals", "<h1>Onboarding approvals</h1><p>Use the link in your email.</p>");

    const form = request.method === "POST" ? await request.formData() : null;
    const p = String(form?.get("p") ?? url.searchParams.get("p") ?? "");
    const s = String(form?.get("s") ?? url.searchParams.get("s") ?? "");
    const link = await verifyLink(env.APPROVAL_LINK_SECRET, p, s);
    if (!link) return page("Invalid link", "<h1>This link isn't valid</h1><p>It may have been copied incompletely. Use the button in the original email.</p>", 400);

    const verb = VERBS[link.d];
    if (request.method === "GET") {
      return page(
        verb,
        `<h1>${escape(link.l)}</h1><p>Signed in as <b>${escape(link.w)}</b> (from your email link).</p>
<form method="POST" action="/a"><input type="hidden" name="p" value="${escape(p)}"><input type="hidden" name="s" value="${escape(s)}">
<label for="c">${link.d === "reject" ? "Reason (sent to the hiring manager and HR)" : "Comment (optional)"}</label>
<textarea id="c" name="comment" ${link.d === "reject" ? "required" : ""}></textarea>
<button style="background:${COLORS[link.d]}" type="submit">${verb}</button></form>
<p class="muted">Nothing is recorded until you press the button.</p>`,
      );
    }
    if (request.method !== "POST") return page("Not allowed", "<h1>Not allowed</h1>", 405);

    const output: DecisionOutput = { decision: link.d, by: link.w, comment: String(form?.get("comment") ?? "").slice(0, 1000), at: new Date().toISOString() };
    try {
      const result = await completeWaiting(env, link.e, link.t, output);
      if (result === "none") {
        return page("Already handled", "<h1>Nothing is waiting on this link</h1><p>It was already answered (by you or a backup), or the request was closed. No change was made.</p>");
      }
      return page("Recorded", `<h1>Recorded: ${escape(verb)}</h1><p>${escape(link.l)}</p><p>Thanks, ${escape(link.w)}. You can close this tab.</p>`);
    } catch (error) {
      return page("Try again", `<h1>Couldn't record that</h1><p>The onboarding system didn't respond (${escape((error as Error).message)}). Please try again in a few minutes.</p>`, 502);
    }
  },
};
