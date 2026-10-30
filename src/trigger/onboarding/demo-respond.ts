import { logger, runs, task, wait } from "@trigger.dev/sdk";
import { signLink } from "../../../relay/link.js";
import { linkEnv } from "./lib/approvals.js";
import { assertDev } from "./reset-demo.js";

type Action = "approve" | "reject" | "ignore";

export type DemoRespondPayload = {
  offerId: string;
  /** What to do with items not listed in `items` (default "approve"). */
  default?: Action;
  /** Per item id, e.g. { hubspot: "reject", zendesk: "ignore" }. Reject applies to approval steps only. */
  items?: Record<string, Action>;
  comment?: string;
  /** Stop after this many minutes even if the hire isn't finished (default 20). */
  maxMinutes?: number;
};

/**
 * DEV ONLY. Stands in for the approvers in a demo: answers whatever a hire is waiting on by posting
 * to the real approval relay, exactly like pressing the button on the confirm page. Items set to
 * "ignore" are left alone so the reminder → escalation → stalled path runs.
 */
export const demoRespond = task({
  id: "onboarding-demo-respond",
  maxDuration: 600,
  run: async (payload: DemoRespondPayload, { ctx }) => {
    assertDev(ctx.environment.type, "onboarding-demo-respond");
    const relay = process.env.APPROVAL_RELAY_URL?.trim().replace(/\/+$/, "");
    if (!relay) throw new Error("APPROVAL_RELAY_URL is not set");
    const secret = process.env.APPROVAL_LINK_SECRET;
    if (!secret) throw new Error("APPROVAL_LINK_SECRET is not set");

    const hireTag = `hire_${payload.offerId}`;
    const env = linkEnv(ctx.environment.type);
    const deadline = Date.now() + (payload.maxMinutes ?? 20) * 60_000;
    const answered: string[] = [];
    const seen = new Set<string>();

    while (Date.now() < deadline) {
      for await (const token of wait.listTokens({ status: "WAITING", tags: [hireTag] })) {
        if (seen.has(token.id) || !token.tags.includes(hireTag)) continue;
        const item = token.tags.find((t) => t.startsWith("item_"))?.slice(5) ?? "";
        const apprTag = token.tags.find((t) => t.startsWith("appr_"));
        if (!apprTag) continue;
        const action = payload.items?.[item] ?? payload.default ?? "approve";
        if (action === "ignore") continue;
        const isDone = token.tags.includes("kind_done");
        const decision = isDone ? "done" : action === "reject" ? "reject" : "approve";

        const query = new URLSearchParams(await signLink(secret, { t: apprTag, d: decision, w: "Demo simulator", l: `Demo: ${decision} ${item}`, e: env }));
        const comment = decision === "reject" ? (payload.comment ?? "Demo: not needed for this role") : "";
        const response = await fetch(`${relay}/a`, { method: "POST", body: new URLSearchParams({ p: query.get("p")!, s: query.get("s")!, comment }) });
        const body = await response.text();
        seen.add(token.id);
        if (response.ok && body.includes("Recorded")) {
          answered.push(`${item}: ${decision}`);
          logger.info("Answered", { item, decision });
        } else {
          logger.warn("Relay did not record the answer", { item, decision, status: response.status });
        }
      }

      const [parent] = (await runs.list({ tag: hireTag, taskIdentifier: "onboarding-hire", limit: 1 })).data;
      if (parent?.isCompleted) break;
      // Waits over 5s are checkpointed, so polling costs no compute while idle.
      await wait.for({ seconds: 15 });
    }

    return { offerId: payload.offerId, answered: answered.length, details: answered };
  },
});
