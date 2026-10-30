// The onboarding spreadsheet: one tab per table. This is the "ticket tool" for the demo; every
// call is retried with backoff, so a short Sheets outage or rate limit (60 writes/min) is ridden out.
import { retry } from "@trigger.dev/sdk";
import { columnLetter, SheetClient, type TableSpec, type TabInfo } from "./table.js";

export const TABS = {
  offers: "Offers",
  hires: "Hires",
  tasks: "Tasks",
  approvals: "Approvals",
  dashboard: "Dashboard",
  metrics: "Metrics",
  questions: "Questions",
} as const;
export type TabName = (typeof TABS)[keyof typeof TABS];

export const OFFER_STATUSES = ["Draft", "Sent", "Signed", "Withdrawn"];

/** Statuses an item can end in. Anything else is still open. */
export const CLOSED_STATUSES = ["Done", "Rejected", "Stalled", "Cancelled", "Error"];

const green = { bg: "#D9EAD3", fg: "#1E5631" };
const amber = { bg: "#FFF2CC", fg: "#7F6000" };
const red = { bg: "#F4CCCC", fg: "#990000" };
const grey = { bg: "#EEEEEE", fg: "#555555" };
const pill = (column: string, value: string, c: { bg: string; fg: string }) => ({ column, condition: "TEXT_EQ" as const, value, ...c });

export const SPECS: Record<TabName, TableSpec> = {
  Offers: {
    frozenColumns: 2,
    columns: [
      { header: "Offer ID", width: 110 },
      { header: "New Hire", width: 160 },
      { header: "Personal Email", width: 240 },
      { header: "Role", width: 120 },
      { header: "Hiring Manager", width: 140 },
      { header: "Start Date", width: 110 },
      { header: "Offer Status", width: 120 },
      { header: "Signed At", width: 160 },
      { header: "Onboarding", width: 150 },
      { header: "Run ID", width: 220, muted: true },
      { header: "Notes", width: 320 },
    ],
    dropdowns: [{ column: "Offer Status", options: OFFER_STATUSES }],
    pills: [
      pill("Offer Status", "Signed", green),
      pill("Offer Status", "Withdrawn", grey),
      pill("Onboarding", "Ready", green),
      pill("Onboarding", "In progress", amber),
      pill("Onboarding", "Incomplete", red),
      pill("Onboarding", "Needs HR review", red),
      pill("Onboarding", "Cancelled", grey),
    ],
  },
  Hires: {
    frozenColumns: 2,
    columns: [
      { header: "Hire ID", width: 110 },
      { header: "New Hire", width: 160 },
      { header: "Role", width: 120 },
      { header: "Manager", width: 140 },
      { header: "Start Date", width: 110 },
      { header: "Signed At", width: 160 },
      { header: "Items", width: 70, align: "RIGHT" },
      { header: "Fully Ready At", width: 160 },
      { header: "Hours to Ready", width: 90, align: "RIGHT" },
      { header: "Ready Before Start", width: 100 },
      { header: "Status", width: 130 },
    ],
    pills: [pill("Status", "Ready", green), pill("Status", "In progress", amber), pill("Status", "Incomplete", red), pill("Status", "Cancelled", grey)],
  },
  Tasks: {
    frozenColumns: 4,
    columns: [
      { header: "Key", width: 200, muted: true },
      { header: "Hire ID", width: 100, minWidth: 90 },
      { header: "New Hire", width: 150, minWidth: 110 },
      { header: "Item", width: 240, minWidth: 200 },
      { header: "Type", width: 100, minWidth: 95 },
      // "Owner approval", "Manager approval", "Provisioning" stay on one line.
      { header: "Step", width: 150, minWidth: 140 },
      { header: "Waiting On", width: 220, minWidth: 140 },
      { header: "Status", width: 170, minWidth: 110 },
      { header: "Due", width: 100, minWidth: 95 },
      { header: "Last Update", width: 160, minWidth: 150 },
      { header: "Notes", width: 360, minWidth: 220 },
    ],
    pills: [
      pill("Status", "Done", green),
      pill("Status", "Waiting", amber),
      pill("Status", "Reminded", amber),
      pill("Status", "Escalated", red),
      pill("Status", "Stalled", red),
      pill("Status", "Rejected", red),
      pill("Status", "Error", red),
      pill("Status", "Cancelled", grey),
    ],
  },
  Approvals: {
    frozenColumns: 0,
    columns: [
      { header: "Time", width: 160 },
      { header: "Hire ID", width: 100 },
      { header: "New Hire", width: 150 },
      { header: "Item", width: 240, minWidth: 200 },
      { header: "Step", width: 150, minWidth: 140 },
      { header: "Decision", width: 100 },
      { header: "By", width: 140 },
      { header: "Comment", width: 320 },
    ],
    pills: [pill("Decision", "approve", green), pill("Decision", "done", green), pill("Decision", "reject", red), pill("Decision", "stalled", red)],
  },
  Dashboard: {
    frozenColumns: 1,
    columns: [
      { header: "New Hire", width: 160 },
      { header: "Role", width: 110 },
      { header: "Manager", width: 130 },
      { header: "Start Date", width: 110 },
      { header: "Days to Start", width: 80, align: "RIGHT" },
      { header: "% Ready", width: 80, align: "RIGHT" },
      { header: "Open Items", width: 380 },
      { header: "Red Flags", width: 320 },
      { header: "Missed Tasks", width: 80, align: "RIGHT" },
      { header: "Status", width: 120 },
    ],
    pills: [pill("Status", "Ready", green), pill("Status", "On track", amber), pill("Status", "At risk", red), pill("Status", "Incomplete", red)],
  },
  Metrics: {
    frozenColumns: 0,
    columns: [
      { header: "Metric", width: 260 },
      { header: "Value", width: 120, align: "RIGHT" },
      { header: "How it's counted", width: 420 },
    ],
  },
  Questions: {
    frozenColumns: 0,
    columns: [
      { header: "Received", width: 160 },
      { header: "From", width: 220 },
      { header: "Subject", width: 220 },
      { header: "Outcome", width: 120 },
      { header: "Routed To", width: 130 },
      { header: "Answer / Reason", width: 420 },
      { header: "Sources", width: 220 },
    ],
    pills: [pill("Outcome", "Answered", green), pill("Outcome", "Handed off", amber)],
  },
};

export type Row = Record<string, string>;
export type StoredRow = { rowNumber: number; data: Row };

// Google allows 60 reads per minute per service account. When many item runs start together they
// hit that (429), so retries must outlast the one-minute window: 8 attempts, 3s → 60s apart (~4 min).
const RETRY = { maxAttempts: 8, minTimeoutInMs: 3000, maxTimeoutInMs: 60000, factor: 2, randomize: true };

function access() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const sheetId = process.env.ONBOARDING_SHEET_ID?.trim();
  if (!sheetId) throw new Error("ONBOARDING_SHEET_ID is not set");
  return { serviceAccountJson, sheetId };
}

function lastColumn(tab: TabName) {
  return columnLetter(SPECS[tab].columns.length - 1);
}

function toCells(tab: TabName, row: Row): string[] {
  return SPECS[tab].columns.map((c) => row[c.header] ?? "");
}

export class Store {
  private constructor(private client: SheetClient) {}

  static async open(): Promise<Store> {
    return new Store(await retry.onThrow(() => SheetClient.connect(access()), RETRY));
  }

  /** All data rows of a tab, keyed by header. */
  async rows(tab: TabName): Promise<StoredRow[]> {
    const values = await retry.onThrow(() => this.client.getValues(tab, `A1:${lastColumn(tab)}`), RETRY);
    const header = values[0] ?? [];
    return values.slice(1).map((cells, i) => ({
      rowNumber: i + 2,
      data: Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""])),
    }));
  }

  async append(tab: TabName, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    await retry.onThrow(() => this.client.appendValues(tab, rows.map((r) => toCells(tab, r))), RETRY);
  }

  /** Writes `patch` over one stored row (other cells keep their values). */
  async patch(tab: TabName, row: StoredRow, patch: Row): Promise<void> {
    const merged = { ...row.data, ...patch };
    await retry.onThrow(() => this.client.putValues(tab, `A${row.rowNumber}:${lastColumn(tab)}${row.rowNumber}`, [toCells(tab, merged)]), RETRY);
    row.data = merged;
  }

  /** Finds the row whose `column` equals `key` and patches it. Returns false if there is none. */
  async update(tab: TabName, column: string, key: string, patch: Row): Promise<boolean> {
    const row = (await this.rows(tab)).find((r) => r.data[column] === key);
    if (!row) return false;
    await this.patch(tab, row, patch);
    return true;
  }

  /** Replaces all data rows (for Dashboard and Metrics, which are rebuilt each time). */
  async replaceAll(tab: TabName, rows: Row[]): Promise<void> {
    await retry.onThrow(() => this.client.clearValues(tab, `A2:${lastColumn(tab)}`), RETRY);
    if (rows.length > 0) await retry.onThrow(() => this.client.putValues(tab, "A2", rows.map((r) => toCells(tab, r))), RETRY);
  }

  async tabInfo(tab: TabName): Promise<TabInfo> {
    return retry.onThrow(() => this.client.ensureTab(tab), RETRY);
  }

  /** Creates the tab if needed and applies headers and styling. Safe to run again. */
  async layout(tab: TabName): Promise<void> {
    const info = await this.tabInfo(tab);
    await retry.onThrow(() => this.client.applyLayout(info, SPECS[tab]), RETRY);
  }

  /** Re-fits column widths and row heights after writes. */
  async fit(tab: TabName): Promise<void> {
    const info = await this.tabInfo(tab);
    await retry.onThrow(() => this.client.fitColumns(info, SPECS[tab]), RETRY);
  }
}

/** Key of an item's row in the Tasks tab. */
export function taskKey(hireId: string, itemId: string): string {
  return `${hireId}:${itemId}`;
}
