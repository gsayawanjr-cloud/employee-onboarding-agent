import { batch, idempotencyKeys, logger, task } from "@trigger.dev/sdk";
import { assignItem } from "./assign-item.js";
import { checklistFor, HR, PEOPLE } from "./config/company.js";
import { dueDate } from "./lib/approvals.js";
import { refreshDashboard } from "./lib/dashboard.js";
import type { Hire, ItemOutcome } from "./lib/hire.js";
import { addressOf, escapeHtml, htmlTable, layout, sendAlert, trySend } from "./lib/mail.js";
import { Store, TABS, taskKey } from "./lib/store.js";
import { parseDate, stamp } from "./lib/time.js";
import { requestAccess } from "./request-access.js";

export function hireTag(offerId: string): string {
  return `hire_${offerId}`;
}

/**
 * Orchestrator: one run per new hire, from signed offer to fully ready. Writes the checklist to the
 * Tasks tab, starts one child run per item (they wait for approvals in parallel), then records when
 * the hire became fully ready. Runs for days; the waiting is checkpointed and costs nothing.
 */
export const onboardHire = task({
  id: "onboarding-hire",
  run: async (hire: Hire) => {
    const items = checklistFor(hire.role);
    const store = await Store.open();
    const manager = PEOPLE[hire.managerId];

    // Rows are keyed, so a retried run doesn't add duplicates.
    if (!(await store.rows(TABS.hires)).some((r) => r.data["Hire ID"] === hire.offerId)) {
      await store.append(TABS.hires, [
        {
          "Hire ID": hire.offerId,
          "New Hire": hire.name,
          Role: hire.role,
          Manager: manager.name,
          "Start Date": hire.startDate,
          "Signed At": stamp(new Date(hire.signedAt)),
          Items: String(items.length),
          Status: "In progress",
        },
      ]);
    }
    const existing = new Set((await store.rows(TABS.tasks)).map((r) => r.data["Key"]));
    await store.append(
      TABS.tasks,
      items
        .filter((item) => !existing.has(taskKey(hire.offerId, item.id)))
        .map((item) => ({
          Key: taskKey(hire.offerId, item.id),
          "Hire ID": hire.offerId,
          "New Hire": hire.name,
          Item: item.name,
          Type: item.kind === "access" ? "Access" : item.kind === "equipment" ? "Equipment" : "Training",
          Step: "Queued",
          "Waiting On": "",
          Status: "Pending",
          Due: dueDate(hire, item),
          "Last Update": stamp(),
        })),
    );

    const kickoff = `Onboarding started: ${hire.name} (${hire.role}), starts ${hire.startDate}`;
    await trySend({
      to: addressOf(hire.managerId),
      subject: kickoff,
      html: layout(
        kickoff,
        `<p>Hi ${escapeHtml(manager.name.split(" ")[0]!)}, ${escapeHtml(hire.name)} signed their offer. Here's what has been requested. You'll get an approval email for each system; every account also needs its system owner's approval.</p>` +
          htmlTable(["Item", "Owner", "Due"], items.map((i) => [i.name, PEOPLE[i.owner].name, dueDate(hire, i)])) +
          `<p>Progress is on the Dashboard tab of the onboarding sheet, and in your 8am digest.</p>`,
      ),
      text: `${kickoff}\n\n${items.map((i) => `- ${i.name} (owner: ${PEOPLE[i.owner].name}, due ${dueDate(hire, i)})`).join("\n")}`,
    });

    // One child per item, all waiting in parallel. Keys are scoped to this run, so a retry reuses the same children.
    const children = [];
    for (const item of items) {
      children.push({
        task: item.kind === "access" ? requestAccess : assignItem,
        payload: { hire, itemId: item.id },
        options: { idempotencyKey: await idempotencyKeys.create(item.id), tags: [hireTag(hire.offerId)] },
      });
    }
    const results = await batch.triggerByTaskAndWait(children);

    const outcomes: ItemOutcome[] = [];
    for (const [i, run] of results.runs.entries()) {
      const item = items[i]!;
      if (run.ok) {
        outcomes.push(run.output as ItemOutcome);
        continue;
      }
      const message = run.error instanceof Error ? run.error.message : JSON.stringify(run.error);
      logger.error("Item run failed", { item: item.id, message });
      await store.update(TABS.tasks, "Key", taskKey(hire.offerId, item.id), { Status: "Error", "Waiting On": "", Notes: `Run failed: ${message}`.slice(0, 500), "Last Update": stamp() });
      outcomes.push({ itemId: item.id, status: "Stalled", detail: `Error: ${message}` });
    }

    const notDone = outcomes.filter((o) => o.status !== "Done");
    const readyAt = new Date();
    if (notDone.length === 0) {
      const start = parseDate(hire.startDate);
      const hours = ((readyAt.getTime() - new Date(hire.signedAt).getTime()) / 3_600_000).toFixed(1);
      await store.update(TABS.hires, "Hire ID", hire.offerId, {
        "Fully Ready At": stamp(readyAt),
        "Hours to Ready": hours,
        "Ready Before Start": start && readyAt <= start ? "Yes" : "No",
        Status: "Ready",
      });
      await store.update(TABS.offers, "Offer ID", hire.offerId, { Onboarding: "Ready" });
    } else {
      await store.update(TABS.hires, "Hire ID", hire.offerId, { Status: "Incomplete" });
      await store.update(TABS.offers, "Offer ID", hire.offerId, { Onboarding: "Incomplete" });
    }

    const subject = notDone.length === 0 ? `${hire.name} is fully ready` : `${hire.name}: ${notDone.length} item(s) not done`;
    await trySend({
      to: addressOf(hire.managerId),
      cc: notDone.length ? [addressOf(HR)] : undefined,
      subject,
      html: layout(subject, htmlTable(["Item", "Result"], outcomes.map((o) => [items.find((i) => i.id === o.itemId)?.name ?? o.itemId, `${o.status}: ${o.detail}`]))),
      text: outcomes.map((o) => `${o.itemId}: ${o.status} (${o.detail})`).join("\n"),
    });
    await refreshDashboard(store);
    return { hire: hire.offerId, ready: notDone.length === 0, outcomes };
  },
  onFailure: async ({ payload, error }) => {
    await sendAlert(`Onboarding run failed for ${payload.name} (${payload.offerId})`, [(error as Error)?.message ?? String(error)]);
  },
});
