import { logger, schedules } from "@trigger.dev/sdk";
import { HR, IT_HELPDESK, PEOPLE } from "./config/company.js";
import { loadPolicyDocs } from "./lib/drive.js";
import { addressOf, escapeHtml, fetchHelpdeskEmails, helpdeskAddress, layout, markProcessed, sendEmail } from "./lib/mail.js";
import { answerQuestion } from "./lib/policy.js";
import { Store, TABS } from "./lib/store.js";
import { stamp } from "./lib/time.js";

/** Max emails per check, so a flood can't run up Claude costs in one go. */
const BATCH = 10;

/**
 * Every 15 minutes: answer policy questions sent to the helpdesk address, using only the approved
 * docs in the Drive folder. Anything not clearly covered, or sensitive, goes to HR or IT.
 */
export const policyInbox = schedules.task({
  id: "onboarding-policy-inbox",
  // A short window keeps the 15-minute checks on time (the default window is 60 minutes).
  cron: { pattern: "*/15 * * * *", window: "5m" },
  run: async () => {
    const emails = await fetchHelpdeskEmails(BATCH);
    if (emails.length === 0) return { handled: 0 };
    const docs = await loadPolicyDocs();
    const store = await Store.open();
    let answered = 0;
    let handedOff = 0;

    for (const email of emails) {
      if (!email.replyAddress) {
        await markProcessed(email.messageId);
        continue;
      }
      const result = await answerQuestion(email, docs);
      const first = email.fromName.split(" ")[0] || "there";
      const subject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject || "Your question"}`;

      if (result.outcome === "answered") {
        const sources = result.quotes.map((q) => `"${q.text}" (${q.doc})`);
        await sendEmail({
          to: email.replyAddress,
          replyTo: helpdeskAddress(),
          inReplyTo: `<${email.messageId}>`,
          subject,
          html: layout(
            "Answer from the policy handbook",
            `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(result.answer)}</p><p style="color:#555"><b>From the approved policy:</b><br>${sources.map(escapeHtml).join("<br>")}</p><p style="color:#666;font-size:12px">This answer was generated automatically from the approved policy documents. If it doesn't cover your situation, reply and a person from HR will pick it up.</p>`,
          ),
          text: `Hi ${first},\n\n${result.answer}\n\nFrom the approved policy:\n${sources.join("\n")}\n\nThis answer was generated automatically from the approved policy documents. If it doesn't cover your situation, reply and a person from HR will pick it up.`,
        });
        answered++;
      } else {
        const owner = result.route === "IT" ? IT_HELPDESK : HR;
        const ownerName = `${PEOPLE[owner].name} (${result.route})`;
        // The person who owns the question gets it first; only then is the employee told who has it.
        await sendEmail({
          to: addressOf(owner),
          replyTo: email.replyAddress,
          subject: `Helpdesk question for ${result.route}: ${email.subject}`,
          html: layout(`Question handed to ${result.route}`, `<p><b>From:</b> ${escapeHtml(email.fromName)} &lt;${escapeHtml(email.replyAddress)}&gt;<br><b>Why it came to you:</b> ${escapeHtml(result.reason)}</p><pre style="white-space:pre-wrap;font-family:inherit;background:#F3F6FB;padding:10px">${escapeHtml(email.text)}</pre><p>Reply to this email to answer the employee directly.</p>`),
          text: `From: ${email.fromName} <${email.replyAddress}>\nWhy: ${result.reason}\n\n${email.text}`,
        });
        await sendEmail({
          to: email.replyAddress,
          replyTo: addressOf(owner),
          inReplyTo: `<${email.messageId}>`,
          subject,
          html: layout("Your question is with a person", `<p>Hi ${escapeHtml(first)},</p><p>Thanks for your question. It needs a person rather than an automatic answer, so it has been passed to ${escapeHtml(ownerName)}, who will reply to you directly.</p>`),
          text: `Hi ${first},\n\nThanks for your question. It needs a person rather than an automatic answer, so it has been passed to ${ownerName}, who will reply to you directly.`,
        });
        handedOff++;
      }

      await store.append(TABS.questions, [
        {
          Received: stamp(new Date(email.receivedAt)),
          From: `${email.fromName} <${email.replyAddress}>`,
          Subject: email.subject,
          Outcome: result.outcome === "answered" ? "Answered" : "Handed off",
          "Routed To": result.outcome === "answered" ? "" : result.route,
          "Answer / Reason": result.outcome === "answered" ? result.answer : result.reason,
          Sources: result.outcome === "answered" ? result.sources.join(", ") : "",
        },
      ]);
      await markProcessed(email.messageId);
    }

    await store.fit(TABS.questions);
    logger.info("Helpdesk checked", { answered, handedOff });
    return { handled: emails.length, answered, handedOff };
  },
});
