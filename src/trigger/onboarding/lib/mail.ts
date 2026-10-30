// Gmail send (SMTP) and helpdesk inbox read (IMAP), both with an app password.
// Adapted from Customer support/src/trigger/support/gmail.ts.
import { logger, retry } from "@trigger.dev/sdk";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { PEOPLE, type PersonId } from "../config/company.js";

export type GmailSettings = { user: string; appPassword: string };

export function gmailSettings(): GmailSettings {
  const user = process.env.ONBOARDING_GMAIL_USER;
  if (!user) throw new Error("ONBOARDING_GMAIL_USER is not set");
  const appPassword = process.env.ONBOARDING_GMAIL_APP_PASSWORD;
  if (!appPassword) throw new Error("ONBOARDING_GMAIL_APP_PASSWORD is not set");
  return { user: user.trim().toLowerCase(), appPassword: appPassword.replace(/\s/g, "") };
}

export function companyName(): string {
  return process.env.COMPANY_NAME?.trim() || "Northwind Labs";
}

function alias(settings: GmailSettings, name: string): string {
  const [local, domain] = settings.user.split("@");
  return `${local}+${name}@${domain}`;
}

/** A dummy person's address: a +alias of the onboarding Gmail, so all demo mail lands in one inbox. */
export function addressOf(id: PersonId, settings = gmailSettings()): string {
  return alias(settings, PEOPLE[id].alias);
}

/** Where employees send policy questions. Default: the Gmail's +helpdesk alias. */
export function helpdeskAddress(settings = gmailSettings()): string {
  return process.env.HELPDESK_INBOX_ADDRESS?.trim().toLowerCase() || alias(settings, "helpdesk");
}

export type Email = {
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  inReplyTo?: string;
};

/** Sends an email, retrying 3 times. Throws if it still fails. */
export async function sendEmail(email: Email): Promise<void> {
  const settings = gmailSettings();
  await retry.onThrow(
    () =>
      nodemailer.createTransport({ service: "gmail", auth: { user: settings.user, pass: settings.appPassword } }).sendMail({
        from: { name: `${companyName()} Onboarding`, address: settings.user },
        to: email.to,
        cc: email.cc,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.inReplyTo ? { inReplyTo: email.inReplyTo, references: email.inReplyTo } : {}),
      }),
    { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, factor: 2 },
  );
}

/** Sends an email and reports whether it went. Never throws: a mail outage must not lose an approval. */
export async function trySend(email: Email): Promise<boolean> {
  try {
    await sendEmail(email);
    return true;
  } catch (error) {
    logger.error("Email not sent", { subject: email.subject, message: (error as Error).message });
    return false;
  }
}

/** Emails ALERT_EMAIL_TO (you, the automation's owner). Never throws. */
export async function sendAlert(subject: string, lines: string[]): Promise<boolean> {
  const to = process.env.ALERT_EMAIL_TO?.trim();
  if (!to) {
    logger.warn("Alert not sent: ALERT_EMAIL_TO is not set", { subject });
    return false;
  }
  return trySend({ to, subject: `[Onboarding alert] ${subject}`, text: lines.join("\n"), html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")) });
}

// ─── HTML ──────────────────────────────────────────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function button(label: string, href: string, color: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:6px;margin:4px 8px 4px 0">${escapeHtml(label)}</a>`;
}

/** Simple branded wrapper; `body` is already HTML. */
export function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;color:#1F1F1F;max-width:620px">
<div style="background:#1F3864;color:#fff;padding:14px 18px;font-weight:bold">${escapeHtml(companyName())} · Onboarding</div>
<div style="padding:18px;border:1px solid #E1E5EB;border-top:0"><h2 style="font-size:18px;color:#1F3864;margin-top:0">${escapeHtml(title)}</h2>${body}</div></div>`;
}

export function htmlTable(headers: string[], rows: string[][]): string {
  const cell = "padding:6px 8px;border-bottom:1px solid #E1E5EB;text-align:left;vertical-align:top";
  return `<table style="border-collapse:collapse;font-size:14px;width:100%"><tr>${headers.map((h) => `<th style="${cell};background:#F3F6FB">${escapeHtml(h)}</th>`).join("")}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td style="${cell}">${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</table>`;
}

// ─── Helpdesk inbox (IMAP) ─────────────────────────────────────────────────────────────────

export const PROCESSED_LABEL = "helpdesk-processed";

export type InboxEmail = { messageId: string; receivedAt: string; fromName: string; replyAddress: string; subject: string; text: string };

async function connect(settings: GmailSettings): Promise<ImapFlow> {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: settings.user, pass: settings.appPassword }, logger: false });
  try {
    await client.connect();
  } catch (error) {
    const e = error as Error & { responseText?: string; serverResponseCode?: string };
    throw new Error(
      e.serverResponseCode === "AUTHENTICATIONFAILED"
        ? "Gmail rejected the login: check ONBOARDING_GMAIL_USER and ONBOARDING_GMAIL_APP_PASSWORD"
        : (e.responseText ?? e.message),
    );
  }
  return client;
}

function bareId(messageId: string): string {
  return messageId.trim().replace(/^<|>$/g, "");
}

/** Unhandled emails sent to the helpdesk address, oldest first. */
export async function fetchHelpdeskEmails(limit: number): Promise<InboxEmail[]> {
  const settings = gmailSettings();
  const query = `in:inbox to:${helpdeskAddress(settings)} -label:${PROCESSED_LABEL} newer_than:14d`;
  const client = await connect(settings);
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = ((await client.search({ gmraw: query }, { uid: true })) || []).sort((a, b) => a - b).slice(0, limit);
      const emails: InboxEmail[] = [];
      if (uids.length === 0) return emails;
      for (const message of await client.fetchAll(uids, { source: true, internalDate: true }, { uid: true })) {
        if (!message.source) continue;
        const mail = await simpleParser(message.source);
        if (!mail.messageId) continue;
        const from = mail.from?.value[0];
        emails.push({
          messageId: bareId(mail.messageId),
          receivedAt: (message.internalDate ? new Date(message.internalDate) : (mail.date ?? new Date())).toISOString(),
          fromName: from?.name ?? "",
          replyAddress: (mail.replyTo?.value[0]?.address ?? from?.address ?? "").toLowerCase(),
          subject: mail.subject ?? "",
          text: (mail.text ?? "").trim(),
        });
      }
      return emails.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Labels a helpdesk email as handled, so the next check skips it. */
export async function markProcessed(messageId: string): Promise<void> {
  const client = await connect(gmailSettings());
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ gmraw: `rfc822msgid:${bareId(messageId)}` }, { uid: true })) || [];
      if (uids.length > 0) await client.messageFlagsAdd(uids, [PROCESSED_LABEL], { uid: true, useLabels: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
