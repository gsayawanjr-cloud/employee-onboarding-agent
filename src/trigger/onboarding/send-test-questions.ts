import { task } from "@trigger.dev/sdk";
import { gmailSettings, helpdeskAddress } from "./lib/mail.js";
import nodemailer from "nodemailer";

/** Free: emails three sample policy questions to the helpdesk address (answerable, not covered, sensitive). */
export const sendTestQuestions = task({
  id: "onboarding-send-test-questions",
  run: async () => {
    const settings = gmailSettings();
    const [local, domain] = settings.user.split("@");
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: settings.user, pass: settings.appPassword } });
    const questions = [
      { from: "Priya Shah", alias: "priya", subject: "PTO in my first months", text: "Hi, I'm starting soon. How many vacation days do I get in my first year, and can I take any during my first 90 days?\n\nThanks,\nPriya" },
      { from: "Marco Diaz", alias: "marco", subject: "Bringing my dog to the office", text: "Hello, is it OK to bring my dog to the office on Fridays?\n\nMarco" },
      { from: "Aisha Bello", alias: "aisha", subject: "Salary review timing", text: "Hi, when will my salary be reviewed, and can I negotiate a raise after probation?\n\nAisha" },
    ];
    for (const q of questions) {
      await transport.sendMail({
        from: { name: q.from, address: settings.user },
        replyTo: `${local}+${q.alias}@${domain}`,
        to: helpdeskAddress(settings),
        subject: q.subject,
        text: q.text,
      });
    }
    return { sent: questions.length, to: helpdeskAddress(settings), expected: ["Answered", "Handed off (not in docs)", "Handed off (sensitive: HR)"] };
  },
});
