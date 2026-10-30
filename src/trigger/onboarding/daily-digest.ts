import { logger, schedules } from "@trigger.dev/sdk";
import { MANAGERS, PEOPLE, TIMEZONE } from "./config/company.js";
import { refreshDashboard } from "./lib/dashboard.js";
import { addressOf, escapeHtml, htmlTable, layout, trySend } from "./lib/mail.js";
import { Store } from "./lib/store.js";

/** 8am Mon–Fri: refresh the dashboard and email each manager their hires' open items (only if any). */
export const dailyDigest = schedules.task({
  id: "onboarding-daily-digest",
  cron: { pattern: "0 8 * * 1-5", timezone: TIMEZONE, window: "5m" },
  run: async () => {
    const store = await Store.open();
    const views = await refreshDashboard(store, { fit: true });
    let sent = 0;

    for (const id of MANAGERS) {
      const manager = PEOPLE[id];
      const mine = views.filter((v) => v.manager === manager.name && (v.open.length > 0 || v.flags.length > 0) && v.status !== "Ready");
      if (mine.length === 0) continue;

      const subject = `Onboarding: ${mine.reduce((n, v) => n + v.open.length, 0)} open item(s) for your new hires`;
      const sections = mine.map(
        (v) =>
          `<h3 style="color:#1F3864;margin-bottom:4px">${escapeHtml(v.name)} · ${escapeHtml(v.role)} · starts ${escapeHtml(v.startDate)}${v.daysToStart !== null ? ` (in ${v.daysToStart} days)` : ""} · ${v.percent}% ready</h3>` +
          (v.flags.length ? `<p style="color:#990000"><b>Red flags:</b> ${escapeHtml(v.flags.join("; "))}</p>` : "") +
          htmlTable(["Item", "Status", "Waiting on", "Due"], v.open.map((o) => [o.item, o.status, o.waitingOn, o.overdue ? `${o.due} (overdue)` : o.due])),
      );
      const ok = await trySend({
        to: addressOf(id),
        subject,
        html: layout(subject, `<p>Hi ${escapeHtml(manager.name.split(" ")[0]!)}, here's what is still open.</p>${sections.join("")}`),
        text: mine.map((v) => `${v.name} (${v.percent}% ready, starts ${v.startDate})\n${v.open.map((o) => `- ${o.item}: ${o.status}${o.waitingOn ? `, waiting on ${o.waitingOn}` : ""}`).join("\n")}`).join("\n\n"),
      });
      if (ok) sent++;
    }
    logger.info("Daily digest done", { hires: views.length, digestsSent: sent });
    return { hires: views.length, digestsSent: sent };
  },
});
