import { logger, runs, task } from "@trigger.dev/sdk";
import { PEOPLE } from "./config/company.js";
import { gmailSettings } from "./lib/mail.js";
import { type Row, Store, TABS } from "./lib/store.js";
import { addDays, isoDate } from "./lib/time.js";

const ONBOARDING_TASKS = ["onboarding-hire", "onboarding-request-access", "onboarding-assign-item", "onboarding-demo-respond"];

/** Refuses to run anywhere but the dev environment: demo tools must never touch real onboarding. */
export function assertDev(environmentType: string, taskName: string) {
  if (environmentType !== "DEVELOPMENT") throw new Error(`${taskName} is a demo tool and only runs in the dev environment`);
}

/**
 * DEV ONLY. Starts a fresh demo round: cancels every open onboarding run, clears Hires, Tasks,
 * Approvals, Dashboard and Metrics (Questions is kept), and seeds one offer per scenario with new
 * Offer IDs, so nothing links back to an earlier round. Pass { sign: [1, 2] } to mark those
 * scenarios Signed. In dev, a waiting run keeps its slot (the dev limit is ~25 runs; a hire uses up
 * to 10), so run at most two hires at a time.
 */
export const resetDemo = task({
  id: "onboarding-reset-demo",
  run: async (payload: { sign?: number[] }, { ctx }) => {
    assertDev(ctx.environment.type, "onboarding-reset-demo");

    let cancelled = 0;
    for await (const run of runs.list({ taskIdentifier: ONBOARDING_TASKS, period: "30d" })) {
      if (!run.isCompleted && run.id !== ctx.run.id) {
        await runs.cancel(run.id);
        cancelled++;
      }
    }

    const store = await Store.open();
    for (const tab of [TABS.hires, TABS.tasks, TABS.approvals, TABS.dashboard, TABS.metrics, TABS.offers]) await store.replaceAll(tab, []);

    const round = Date.now().toString(36).slice(-4).toUpperCase();
    const [local, domain] = gmailSettings().user.split("@");
    const personal = (alias: string) => `${local}+${alias}@${domain}`;
    const start = (days: number) => isoDate(addDays(new Date(), days));
    const offer = (n: number, name: string, alias: string, role: string, manager: string, startDate: string, notes: string): Row => ({
      "Offer ID": `OF-${round}-${n}`,
      "New Hire": name,
      "Personal Email": personal(alias),
      Role: role,
      "Hiring Manager": manager,
      "Start Date": startDate,
      "Offer Status": payload.sign?.includes(n) ? "Signed" : "Sent",
      Notes: notes,
    });
    const offers = [
      offer(1, "Priya Shah", "priya", "Engineering", PEOPLE.sam.name, start(10), "Scenario: happy path. Simulator approves everything → fully ready. Then clear Onboarding to test duplicate signing."),
      offer(2, "Marco Diaz", "marco", "Sales", PEOPLE.dana.name, start(12), "Scenario: rejection. Simulator rejects HubSpot at the manager step."),
      offer(3, "Aisha Bello", "aisha", "Support", PEOPLE.maya.name, start(14), "Scenario: silent approver. Zendesk is never answered → reminder, escalation, Stalled."),
      offer(4, "Tom Becker", "tom", "Marketing", PEOPLE.dana.name, start(14), "Scenario: unknown role → Needs HR review."),
      offer(5, "Lena Park", "lena", "Sales", PEOPLE.dana.name, start(9), "Scenario: withdrawn. After it starts, set Offer Status to Withdrawn → runs cancelled."),
      offer(6, "Raj Menon", "raj", "Support", PEOPLE.maya.name, "", "Scenario: bad data. No start date → Needs HR review."),
    ];
    await store.append(TABS.offers, offers);
    for (const tab of [TABS.offers, TABS.tasks, TABS.approvals, TABS.hires, TABS.dashboard]) await store.fit(tab);

    logger.info("Demo reset", { cancelled, round, signed: payload.sign ?? [] });
    return { cancelled, round, offers: offers.map((o) => `${o["Offer ID"]} ${o["New Hire"]}`) };
  },
});
