import { logger, runs, schedules } from "@trigger.dev/sdk";
import { findManager, findRole, HR, PEOPLE, ROLES } from "./config/company.js";
import { refreshDashboard } from "./lib/dashboard.js";
import { addressOf, escapeHtml, layout, trySend } from "./lib/mail.js";
import { CLOSED_STATUSES, Store, type StoredRow, TABS } from "./lib/store.js";
import { isoDate, parseDate, stamp } from "./lib/time.js";
import { hireTag, onboardHire } from "./onboard-hire.js";

/** Why a signed offer can't start onboarding yet, or null if it can. */
function problemWith(row: StoredRow): string | null {
  const d = row.data;
  if (!d["Offer ID"]) return "Offer ID is empty";
  if (!d["New Hire"]) return "New Hire name is empty";
  if (!findRole(d["Role"] ?? "")) return `Role "${d["Role"]}" is not recognized (known roles: ${Object.keys(ROLES).join(", ")})`;
  if (!findManager(d["Hiring Manager"] ?? "")) return `Hiring Manager "${d["Hiring Manager"]}" is not a known manager`;
  if (!parseDate(d["Start Date"] ?? "")) return `Start Date "${d["Start Date"]}" is not a date`;
  return null;
}

async function flagForHr(store: Store, row: StoredRow, problem: string) {
  await store.patch(TABS.offers, row, { Onboarding: "Needs HR review", Notes: `${problem}. Fix the row, then clear the Onboarding cell to retry.` });
  const subject = `Onboarding not started: ${row.data["New Hire"] || row.data["Offer ID"]}`;
  const text = `The offer ${row.data["Offer ID"]} is marked Signed, but onboarding can't start: ${problem}. Fix the row in the Offers tab, then clear its Onboarding cell; it will be picked up within 15 minutes.`;
  await trySend({ to: addressOf(HR), subject, html: layout(subject, `<p>${escapeHtml(text)}</p>`), text });
}

/** Stops a withdrawn offer's onboarding: cancels its runs and closes its open items. */
async function cancelOnboarding(store: Store, row: StoredRow) {
  const offerId = row.data["Offer ID"]!;
  for await (const run of runs.list({ tag: hireTag(offerId) })) {
    if (!run.isCompleted) await runs.cancel(run.id);
  }
  if (row.data["Run ID"]) await runs.cancel(row.data["Run ID"]).catch((e) => logger.warn("Cancel failed", { message: (e as Error).message }));
  for (const task of await store.rows(TABS.tasks)) {
    if (task.data["Hire ID"] === offerId && !CLOSED_STATUSES.includes(task.data["Status"] ?? "")) {
      await store.patch(TABS.tasks, task, { Status: "Cancelled", "Waiting On": "", Notes: "Offer withdrawn", "Last Update": stamp() });
    }
  }
  await store.update(TABS.hires, "Hire ID", offerId, { Status: "Cancelled" });
  await store.patch(TABS.offers, row, { Onboarding: "Cancelled", Notes: `Offer withdrawn; open items cancelled ${stamp()}` });
}

/**
 * Every 15 minutes: start onboarding for newly signed offers, stop it for withdrawn ones, and
 * refresh the Dashboard tab.
 */
export const checkOffers = schedules.task({
  id: "onboarding-check-offers",
  // A short window keeps the 15-minute checks on time (the default window is 60 minutes).
  cron: { pattern: "*/15 * * * *", window: "5m" },
  run: async () => {
    const store = await Store.open();
    let started = 0;
    let flagged = 0;
    let cancelled = 0;
    let duplicates = 0;
    const hires = new Map((await store.rows(TABS.hires)).map((r) => [r.data["Hire ID"], r.data["Status"] ?? ""]));

    for (const row of await store.rows(TABS.offers)) {
      const status = (row.data["Offer Status"] ?? "").trim();
      const onboarding = (row.data["Onboarding"] ?? "").trim();

      if (status === "Withdrawn" && onboarding === "In progress") {
        await cancelOnboarding(store, row);
        cancelled++;
        continue;
      }
      if (status !== "Signed" || onboarding !== "") continue;

      const problem = problemWith(row);
      if (problem) {
        logger.warn("Signed offer needs HR review", { offer: row.data["Offer ID"], problem });
        await flagForHr(store, row, problem);
        flagged++;
        continue;
      }

      const offerId = row.data["Offer ID"]!;
      // Already onboarded (e.g. someone cleared the Onboarding cell): restore its status, start nothing.
      // The idempotency key below would also block a second run; this keeps the row truthful.
      const existing = hires.get(offerId);
      if (existing !== undefined) {
        await store.patch(TABS.offers, row, { Onboarding: existing || "In progress", Notes: `Duplicate signing ignored ${stamp()}: this offer was already onboarded` });
        duplicates++;
        continue;
      }

      const signedAt = parseDate(row.data["Signed At"] ?? "") ?? new Date();
      // The idempotency key means a second "Signed" for the same offer never starts a second onboarding.
      const handle = await onboardHire.trigger(
        {
          offerId,
          name: row.data["New Hire"]!,
          role: findRole(row.data["Role"]!)!,
          managerId: findManager(row.data["Hiring Manager"]!)!,
          startDate: isoDate(parseDate(row.data["Start Date"]!)!),
          signedAt: signedAt.toISOString(),
        },
        { idempotencyKey: `onboard-${offerId}`, idempotencyKeyTTL: "365d", tags: [hireTag(offerId)] },
      );
      await store.patch(TABS.offers, row, {
        "Signed At": row.data["Signed At"] || stamp(signedAt),
        Onboarding: "In progress",
        "Run ID": handle.id,
        Notes: `Onboarding started ${stamp()}; manager ${PEOPLE[findManager(row.data["Hiring Manager"]!)!].name} notified`,
      });
      started++;
    }

    await store.fit(TABS.offers);
    await refreshDashboard(store, { fit: true });
    logger.info("Offers checked", { started, flagged, cancelled, duplicates });
    return { started, flagged, cancelled, duplicates };
  },
});
