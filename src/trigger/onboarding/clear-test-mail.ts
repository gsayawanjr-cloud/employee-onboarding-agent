import { logger, task } from "@trigger.dev/sdk";
import { ImapFlow } from "imapflow";
import { PEOPLE } from "./config/company.js";
import { companyName, gmailSettings, helpdeskAddress } from "./lib/mail.js";
import { assertDev } from "./reset-demo.js";

/** New-hire aliases used by the demo scenarios and send-test-questions (not in PEOPLE). */
const HIRE_ALIASES = ["priya", "marco", "aisha", "tom", "lena", "raj"];

/**
 * DEV ONLY. Finds the demo's emails in Gmail (anything to or from the demo's +aliases or the
 * helpdesk address, or carrying the "<Company> · Onboarding" header, since `since`) and, when
 * dryRun is false, moves them to Trash (Gmail empties Trash after 30 days, so it is recoverable).
 * Defaults to a dry run that only counts and lists subjects.
 */
export const clearTestMail = task({
  id: "onboarding-clear-test-mail",
  run: async (payload: { dryRun?: boolean; since?: string }, { ctx }) => {
    assertDev(ctx.environment.type, "onboarding-clear-test-mail");
    const dryRun = payload.dryRun !== false;
    const since = (payload.since ?? "2026-10-29").replaceAll("-", "/");

    const settings = gmailSettings();
    const [local, domain] = settings.user.split("@");
    const addresses = [...Object.values(PEOPLE).map((p) => p.alias), ...HIRE_ALIASES].map((a) => `${local}+${a}@${domain}`);
    addresses.push(helpdeskAddress(settings));
    const terms = [...addresses.flatMap((a) => [`to:${a}`, `from:${a}`]), `"${companyName()} · Onboarding"`];
    const query = `after:${since} {${terms.join(" ")}}`;

    const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: settings.user, pass: settings.appPassword }, logger: false });
    await client.connect();
    try {
      const boxes = await client.list();
      const allMail = boxes.find((b) => b.specialUse === "\\All")?.path;
      const trash = boxes.find((b) => b.specialUse === "\\Trash")?.path;
      if (!allMail || !trash) throw new Error("Could not find Gmail's All Mail or Trash folder over IMAP");

      const lock = await client.getMailboxLock(allMail);
      try {
        const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
        const subjects: Record<string, number> = {};
        if (uids.length) {
          for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
            const s = (msg.envelope?.subject ?? "(no subject)").replace(/^(Reminder|Escalated): /, "");
            subjects[s] = (subjects[s] ?? 0) + 1;
          }
        }
        const top = Object.entries(subjects).sort((a, b) => b[1] - a[1]).slice(0, 40);

        if (!dryRun && uids.length) await client.messageMove(uids, trash, { uid: true });
        logger.info(dryRun ? "Dry run: nothing moved" : "Moved to Trash", { matched: uids.length });
        return { dryRun, matched: uids.length, movedToTrash: dryRun ? 0 : uids.length, distinctSubjects: Object.keys(subjects).length, topSubjects: top };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  },
});
