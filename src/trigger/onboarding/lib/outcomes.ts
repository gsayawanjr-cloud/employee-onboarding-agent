import { type ChecklistItem, HR, PEOPLE, TIMINGS } from "../config/company.js";
import type { StepResult } from "./approvals.js";
import type { Hire, ItemOutcome } from "./hire.js";
import { addressOf, escapeHtml, layout, trySend } from "./mail.js";
import { type Store, TABS, taskKey } from "./store.js";
import { describeHours, stamp } from "./time.js";

/** Closes an item that won't be done: marks the row, and tells the manager and HR. */
export async function closeUnfinished(store: Store, hire: Hire, item: ChecklistItem, stepName: string, result: StepResult): Promise<ItemOutcome> {
  const stalled = result.decision === "stalled";
  const status = stalled ? "Stalled" : "Rejected";
  const detail = stalled
    ? `${stepName}: no response from ${result.by} after ${describeHours(TIMINGS.stallAfterHours)}`
    : `${stepName}: rejected by ${result.by}${result.comment ? `: "${result.comment}"` : ""}`;
  await store.update(TABS.tasks, "Key", taskKey(hire.offerId, item.id), { Status: status, "Waiting On": "", Notes: detail, "Last Update": stamp() });

  const subject = `${status}: ${item.name} for ${hire.name}`;
  const next = stalled
    ? "Nobody responded, so the automation has stopped chasing this item. Please follow up directly; it is counted as a missed task on the dashboard."
    : "Nothing was requested from the system owner. If this should go ahead, talk to the approver and restart the item.";
  await trySend({
    to: addressOf(hire.managerId),
    cc: [addressOf(HR)],
    subject,
    html: layout(subject, `<p>${escapeHtml(detail)}</p><p>${escapeHtml(next)}</p>`),
    text: `${detail}\n\n${next}`,
  });
  return { itemId: item.id, status, detail };
}

export async function markDone(store: Store, hire: Hire, item: ChecklistItem, by: string, comment: string): Promise<ItemOutcome> {
  const detail = `Done by ${by}${comment ? `: "${comment}"` : ""}`;
  await store.update(TABS.tasks, "Key", taskKey(hire.offerId, item.id), { Status: "Done", "Waiting On": "", Notes: detail, "Last Update": stamp() });
  return { itemId: item.id, status: "Done", detail };
}

export function managerName(hire: Hire): string {
  return PEOPLE[hire.managerId].name;
}
