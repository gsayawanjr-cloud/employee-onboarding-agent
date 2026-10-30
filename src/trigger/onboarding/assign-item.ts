import { task } from "@trigger.dev/sdk";
import { getItem } from "./config/company.js";
import { dueDate, linkEnv, runStep } from "./lib/approvals.js";
import type { ItemOutcome, ItemPayload } from "./lib/hire.js";
import { sendAlert } from "./lib/mail.js";
import { closeUnfinished, managerName, markDone } from "./lib/outcomes.js";
import { Store } from "./lib/store.js";

/** Equipment or training for one new hire: the owner gets the task, a "Mark done" link, and reminders. */
export const assignItem = task({
  id: "onboarding-assign-item",
  run: async ({ hire, itemId }: ItemPayload, { ctx }): Promise<ItemOutcome> => {
    const item = getItem(itemId);
    if (item.kind === "access") throw new Error(`${itemId} is an access item; use onboarding-request-access`);
    const store = await Store.open();
    const what =
      item.kind === "equipment"
        ? `Please prepare ${item.name} for ${hire.name} so it's ready on day one.`
        : `Please enroll ${hire.name} in ${item.name.replace(/^Training: /, "")} and share the schedule with them.`;

    const result = await runStep({
      store,
      hire,
      item,
      runId: ctx.run.id,
      env: linkEnv(ctx.environment.type),
      stepName: "Assigned",
      approver: item.owner,
      backup: item.backup,
      decisions: ["done"],
      question: `${item.name} for ${hire.name}, due ${dueDate(hire, item)}`,
      intro: [`${hire.name} joins as ${hire.role} on ${hire.startDate} (manager: ${managerName(hire)}).`, what, "Press Mark done when it's finished."],
    });
    if (result.decision !== "done") return closeUnfinished(store, hire, item, "Assigned", result);
    return markDone(store, hire, item, result.by, result.comment);
  },
  onFailure: async ({ payload, error }) => {
    await sendAlert(`Task failed: ${payload.itemId} for ${payload.hire.name}`, [(error as Error)?.message ?? String(error)]);
  },
});
