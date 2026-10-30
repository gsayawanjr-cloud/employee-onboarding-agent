import { task } from "@trigger.dev/sdk";
import { getItem, HR, PEOPLE } from "./config/company.js";
import { linkEnv, runStep, type Step } from "./lib/approvals.js";
import type { ItemOutcome, ItemPayload } from "./lib/hire.js";
import { sendAlert } from "./lib/mail.js";
import { closeUnfinished, managerName, markDone } from "./lib/outcomes.js";
import { Store } from "./lib/store.js";

/**
 * One system for one new hire: hiring manager approves, then the system owner approves, then the
 * owner creates the account themselves and clicks "Mark provisioned". This task only requests and
 * records; it never creates an account.
 */
export const requestAccess = task({
  id: "onboarding-request-access",
  run: async ({ hire, itemId }: ItemPayload, { ctx }): Promise<ItemOutcome> => {
    const item = getItem(itemId);
    if (item.kind !== "access") throw new Error(`${itemId} is not an access item`);
    const store = await Store.open();
    const owner = PEOPLE[item.owner];
    const base = { store, hire, item, runId: ctx.run.id, env: linkEnv(ctx.environment.type) };

    const steps: Omit<Step, keyof typeof base>[] = [
      {
        stepName: "Manager approval",
        approver: hire.managerId,
        backup: HR,
        decisions: ["approve", "reject"],
        question: `Approve ${item.name} access for ${hire.name}?`,
        intro: [
          `${hire.name} has signed their offer for ${hire.role}. Their checklist includes ${item.name}.`,
          `If you approve, the request goes to the system owner, ${owner.name}, for their approval. No account is created automatically.`,
        ],
      },
      {
        stepName: "Owner approval",
        approver: item.owner,
        backup: item.backup,
        decisions: ["approve", "reject"],
        question: `Approve ${item.name} access for ${hire.name}? (manager approved)`,
        intro: [
          `${managerName(hire)} has approved ${item.name} access for ${hire.name} (${hire.role}). As the system owner, please approve or reject.`,
          "If you approve, you'll get one more email asking you to create the account and mark it provisioned.",
        ],
      },
      {
        stepName: "Provisioning",
        approver: item.owner,
        backup: item.backup,
        decisions: ["done"],
        doneLabel: "Mark provisioned",
        question: `Please provision ${item.name} for ${hire.name}`,
        intro: [
          `Both approvals are in: ${managerName(hire)} (manager) and you (system owner).`,
          "Please create the account in the system yourself, then press Mark provisioned. This automation does not create accounts.",
        ],
      },
    ];

    let last = { by: "", comment: "" };
    for (const s of steps) {
      const result = await runStep({ ...base, ...s });
      if (result.decision !== "approve" && result.decision !== "done") return closeUnfinished(store, hire, item, s.stepName, result);
      last = result;
    }
    return markDone(store, hire, item, last.by, last.comment);
  },
  onFailure: async ({ payload, error }) => {
    await sendAlert(`Access request failed: ${payload.itemId} for ${payload.hire.name}`, [(error as Error)?.message ?? String(error)]);
  },
});
