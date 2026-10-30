// Rebuilds the Dashboard and Metrics tabs from Hires + Tasks, and returns each manager's open items
// for the daily digest. Called by check-offers (every 15 min), onboard-hire, and daily-digest.
import { CLOSED_STATUSES, type Row, type Store, TABS } from "./store.js";
import { isoDate, parseDate } from "./time.js";

export type OpenItem = { item: string; status: string; waitingOn: string; due: string; overdue: boolean };
export type HireView = { hireId: string; name: string; role: string; manager: string; startDate: string; daysToStart: number | null; percent: number; open: OpenItem[]; flags: string[]; missed: number; status: string };

const DAY = 86_400_000;

export function buildViews(hires: Row[], tasks: Row[], now = new Date()): HireView[] {
  const today = isoDate(now);
  return hires
    .filter((h) => h["Status"] !== "Cancelled")
    .map((h) => {
      const mine = tasks.filter((t) => t["Hire ID"] === h["Hire ID"] && t["Status"] !== "Cancelled");
      const done = mine.filter((t) => t["Status"] === "Done").length;
      const start = parseDate(h["Start Date"] ?? "");
      const started = start ? isoDate(start) <= today : false;
      const open: OpenItem[] = mine
        .filter((t) => !CLOSED_STATUSES.includes(t["Status"] ?? ""))
        .map((t) => ({ item: t["Item"] ?? "", status: t["Status"] ?? "", waitingOn: t["Waiting On"] ?? "", due: t["Due"] ?? "", overdue: !!t["Due"] && t["Due"]! < today }));
      const flags = [
        ...open.filter((o) => o.overdue).map((o) => `${o.item}: overdue (due ${o.due})`),
        ...mine.filter((t) => t["Status"] === "Escalated").map((t) => `${t["Item"]}: escalated`),
        ...mine.filter((t) => ["Stalled", "Rejected", "Error"].includes(t["Status"] ?? "")).map((t) => `${t["Item"]}: ${t["Status"]!.toLowerCase()}`),
        ...mine.filter((t) => (t["Notes"] ?? "").startsWith("Notify failed")).map((t) => `${t["Item"]}: email failed`),
      ];
      // Missed = gave up waiting (stalled), broke (error), or still open once the hire has started.
      const missed = mine.filter((t) => ["Stalled", "Error"].includes(t["Status"] ?? "")).length + (started ? open.length : 0);
      const status = h["Status"] === "Ready" ? "Ready" : h["Status"] === "Incomplete" ? "Incomplete" : flags.length > 0 ? "At risk" : "On track";
      return {
        hireId: h["Hire ID"] ?? "",
        name: h["New Hire"] ?? "",
        role: h["Role"] ?? "",
        manager: h["Manager"] ?? "",
        startDate: h["Start Date"] ?? "",
        daysToStart: start ? Math.ceil((start.getTime() - Date.parse(`${today}T00:00:00Z`)) / DAY) : null,
        percent: mine.length ? Math.round((done / mine.length) * 100) : 0,
        open,
        flags,
        missed,
        status,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function buildMetrics(hires: Row[], views: HireView[]): Row[] {
  const active = hires.filter((h) => h["Status"] !== "Cancelled");
  const ready = active.filter((h) => h["Status"] === "Ready");
  const hours = ready.map((h) => Number(h["Hours to Ready"])).filter((n) => Number.isFinite(n));
  const avg = hours.length ? (hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(1) : "–";
  const onTime = ready.filter((h) => h["Ready Before Start"] === "Yes").length;
  const openItems = views.reduce((n, v) => n + v.open.length, 0);
  return [
    { Metric: "New hires in onboarding (all time)", Value: String(active.length), "How it's counted": "Signed offers that started onboarding, minus withdrawn ones." },
    { Metric: "Fully ready", Value: String(ready.length), "How it's counted": "Every checklist item is Done." },
    { Metric: "Avg hours, signed → fully ready", Value: avg, "How it's counted": "Mean of Hires › Hours to Ready over fully ready hires." },
    { Metric: "Ready before start date", Value: ready.length ? `${Math.round((onTime / ready.length) * 100)}%` : "–", "How it's counted": "Share of fully ready hires who were ready before their first day." },
    { Metric: "Missed tasks", Value: String(views.reduce((n, v) => n + v.missed, 0)), "How it's counted": "Items that stalled (no response in 5 days) or errored, plus items still open on or after the start date." },
    { Metric: "Items open now", Value: String(openItems), "How it's counted": "Items waiting on someone (approval, provisioning, or task)." },
    { Metric: "Last refreshed", Value: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", "How it's counted": "" },
  ];
}

/**
 * Rewrites Dashboard and Metrics, and returns the per-hire views. `fit` re-sizes the tabs too; each
 * fit is an extra Sheets read, so only the scheduled tasks do it, not the per-hire runs.
 */
export async function refreshDashboard(store: Store, options: { fit?: boolean } = {}): Promise<HireView[]> {
  const hires = (await store.rows(TABS.hires)).map((r) => r.data);
  const tasks = (await store.rows(TABS.tasks)).map((r) => r.data);
  const views = buildViews(hires, tasks);
  await store.replaceAll(
    TABS.dashboard,
    views.map((v) => ({
      "New Hire": v.name,
      Role: v.role,
      Manager: v.manager,
      "Start Date": v.startDate,
      "Days to Start": v.daysToStart === null ? "" : String(v.daysToStart),
      "% Ready": `${v.percent}%`,
      "Open Items": v.open.map((o) => `${o.item}: ${o.status}${o.waitingOn ? ` (${o.waitingOn})` : ""}`).join("\n"),
      "Red Flags": v.flags.join("\n"),
      "Missed Tasks": String(v.missed),
      Status: v.status,
    })),
  );
  await store.replaceAll(TABS.metrics, buildMetrics(hires, views));
  // Tasks, Approvals and Hires are written row by row elsewhere, so re-fit them here too.
  if (options.fit) for (const tab of [TABS.dashboard, TABS.tasks, TABS.approvals, TABS.hires]) await store.fit(tab);
  return views;
}
