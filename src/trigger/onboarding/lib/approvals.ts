// One approval or task step: email the person with signed links, wait for their click, remind at
// 24h, escalate to a backup at 48h, and give up as "Stalled" at 5 days. The automation only asks;
// it never creates an account itself.
import { createHash } from "node:crypto";
import { logger, wait } from "@trigger.dev/sdk";
import { type DecisionOutput, type LinkDecision, type LinkEnv, signLink } from "../../../../relay/link.js";
import { type ChecklistItem, PEOPLE, type PersonId, TIMINGS } from "../config/company.js";
import type { Hire } from "./hire.js";
import { addressOf, button, escapeHtml, htmlTable, layout, sendAlert, trySend } from "./mail.js";
import { type Store, TABS, taskKey } from "./store.js";
import { addDays, describeHours, isoDate, parseDate, scaledSeconds, stamp } from "./time.js";

/** Trigger.dev environment type (ctx.environment.type) → which secret key the relay uses. */
export function linkEnv(environmentType: string): LinkEnv {
  if (environmentType === "PRODUCTION") return "prod";
  if (environmentType === "STAGING") return "staging";
  return "dev";
}

function relaySettings() {
  const url = process.env.APPROVAL_RELAY_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("APPROVAL_RELAY_URL is not set");
  const secret = process.env.APPROVAL_LINK_SECRET;
  if (!secret) throw new Error("APPROVAL_LINK_SECRET is not set");
  return { url, secret };
}

const BUTTONS: Record<LinkDecision, { label: string; color: string }> = {
  approve: { label: "Approve", color: "#1E7B4A" },
  reject: { label: "Reject", color: "#B3261E" },
  done: { label: "Mark done", color: "#1F3864" },
};

export function dueDate(hire: Hire, item: ChecklistItem): string {
  const start = parseDate(hire.startDate);
  return start ? isoDate(addDays(start, -item.dueDaysBeforeStart)) : "";
}

export type Step = {
  store: Store;
  hire: Hire;
  item: ChecklistItem;
  /** Shown in the Tasks "Step" column and the Approvals log, e.g. "Manager approval". */
  stepName: string;
  approver: PersonId;
  backup: PersonId;
  decisions: LinkDecision[];
  /** Overrides the "Mark done" button label, e.g. "Mark provisioned". */
  doneLabel?: string;
  /** Shown on the confirm page and as the email heading. */
  question: string;
  /** Paragraphs explaining what is being asked. */
  intro: string[];
  runId: string;
  env: LinkEnv;
};

export type StepResult = DecisionOutput | { decision: "stalled"; by: string; comment: string; at: string };

async function setTask(step: Step, patch: Record<string, string>) {
  await step.store.update(TABS.tasks, "Key", taskKey(step.hire.offerId, step.item.id), { "Last Update": stamp(), ...patch });
}

async function sendRequest(step: Step, tag: string, to: PersonId, kind: "first" | "reminder" | "escalation"): Promise<boolean> {
  const { url, secret } = relaySettings();
  const who = PEOPLE[to];
  const links = await Promise.all(
    step.decisions.map(async (d) => ({ d, href: `${url}/a?${await signLink(secret, { t: tag, d, w: who.name, l: step.question, e: step.env })}` })),
  );
  const approver = PEOPLE[step.approver];
  const prefix = kind === "reminder" ? "Reminder: " : kind === "escalation" ? "Escalated: " : "";
  const notes = {
    first: "",
    reminder: `We haven't heard back in ${describeHours(TIMINGS.remindAfterHours)}. The new hire's start date depends on this.`,
    escalation: `${approver.name} hasn't responded in ${describeHours(TIMINGS.escalateAfterHours)}, so this has been escalated to you as backup. You can decide on their behalf.`,
  }[kind];
  const details = htmlTable(
    ["New hire", "Role", "Start date", "Item", "Due"],
    [[step.hire.name, step.hire.role, step.hire.startDate, step.item.name, dueDate(step.hire, step.item)]],
  );
  const body = [
    notes ? `<p style="background:#FFF2CC;padding:8px 10px;border-radius:4px">${escapeHtml(notes)}</p>` : "",
    `<p>Hi ${escapeHtml(who.name.split(" ")[0]!)},</p>`,
    ...step.intro.map((p) => `<p>${escapeHtml(p)}</p>`),
    details,
    `<p style="margin-top:18px">${links.map((l) => button(l.d === "done" && step.doneLabel ? step.doneLabel : BUTTONS[l.d].label, l.href, BUTTONS[l.d].color)).join("")}</p>`,
    `<p style="color:#666;font-size:12px">Each button opens a confirm page; nothing is recorded until you press the button there.</p>`,
  ].join("");
  return trySend({
    to: addressOf(to),
    cc: kind === "escalation" ? [addressOf(step.approver)] : undefined,
    subject: `${prefix}${step.question}`,
    html: layout(step.question, body),
    text: [notes, ...step.intro, `New hire: ${step.hire.name} (${step.hire.role}), starts ${step.hire.startDate}`, ...links.map((l) => `${BUTTONS[l.d].label}: ${l.href}`)].filter(Boolean).join("\n\n"),
  });
}

async function notifyFailed(step: Step, to: PersonId) {
  await setTask(step, { Notes: `Notify failed: email to ${PEOPLE[to].name} did not send; will retry at the next reminder` });
  await sendAlert(`Email failed for ${step.hire.name}: ${step.item.name}`, [`Could not email ${PEOPLE[to].name} for "${step.stepName}". The next reminder will try again.`]);
}

/** Runs one step to its end: a decision from the approver (or backup), or "stalled" after 5 days. */
export async function runStep(step: Step): Promise<StepResult> {
  // Links point at this tag, not at one token, so they stay valid across reminder phases.
  const tag = `appr_${createHash("sha256").update(`${step.runId}:${step.stepName}`).digest("hex").slice(0, 24)}`;
  const phases = [
    TIMINGS.remindAfterHours,
    TIMINGS.escalateAfterHours - TIMINGS.remindAfterHours,
    TIMINGS.stallAfterHours - TIMINGS.escalateAfterHours,
  ];
  // Idempotency keys make a retried run reuse its tokens (and their decisions) instead of asking again.
  // The extra tags let the dev-only demo simulator find what a hire is waiting on.
  const tags = [tag, `hire_${step.hire.offerId}`, `item_${step.item.id}`, step.decisions.includes("done") ? "kind_done" : "kind_approve"];
  const createToken = (phase: number) =>
    wait.createToken({ timeout: `${scaledSeconds(phases[phase]!)}s`, tags, idempotencyKey: `${tag}-p${phase}` });

  await setTask(step, { Step: step.stepName, "Waiting On": PEOPLE[step.approver].name, Status: "Waiting", Notes: "" });
  let token = await createToken(0);
  if (!(await sendRequest(step, tag, step.approver, "first"))) await notifyFailed(step, step.approver);

  for (let phase = 0; ; phase++) {
    const result = await wait.forToken<DecisionOutput>(token);
    if (result.ok) {
      const output = result.output;
      await logDecision(step, output.decision, output.by, output.comment);
      return output;
    }
    if (phase === phases.length - 1) {
      const by = `${PEOPLE[step.approver].name} / ${PEOPLE[step.backup].name}`;
      await logDecision(step, "stalled", "(no response)", `No response after ${describeHours(TIMINGS.stallAfterHours)}`);
      return { decision: "stalled", by, comment: "", at: new Date().toISOString() };
    }
    // Make the next token before emailing, so a click on the new email always finds one waiting.
    token = await createToken(phase + 1);
    if (phase === 0) {
      logger.info("No response yet: reminding", { item: step.item.id, step: step.stepName });
      await setTask(step, { Status: "Reminded" });
      if (!(await sendRequest(step, tag, step.approver, "reminder"))) await notifyFailed(step, step.approver);
    } else {
      logger.info("Still no response: escalating", { item: step.item.id, step: step.stepName, backup: step.backup });
      await setTask(step, { Status: "Escalated", "Waiting On": `${PEOPLE[step.approver].name} or ${PEOPLE[step.backup].name}` });
      if (!(await sendRequest(step, tag, step.backup, "escalation"))) await notifyFailed(step, step.backup);
    }
  }
}

async function logDecision(step: Step, decision: string, by: string, comment: string) {
  await step.store.append(TABS.approvals, [
    { Time: stamp(), "Hire ID": step.hire.offerId, "New Hire": step.hire.name, Item: step.item.name, Step: step.stepName, Decision: decision, By: by, Comment: comment },
  ]);
}
