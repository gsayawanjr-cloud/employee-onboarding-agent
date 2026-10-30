import { logger, task } from "@trigger.dev/sdk";
import { signLink, verifyLink } from "../../../relay/link.js";
import { checklistFor, findManager, findRole, getItem, PEOPLE, ROLES, TIMINGS } from "./config/company.js";
import { buildViews } from "./lib/dashboard.js";
import { sensitiveTopic, unverifiedQuotes } from "./lib/policy.js";

/** Free, no accounts needed: checks the logic that decides things (links, roles, quotes, dashboard). */
export const onboardingSelfTest = task({
  id: "onboarding-self-test",
  run: async () => {
    const results: { name: string; ok: boolean }[] = [];
    const check = (name: string, ok: boolean) => results.push({ name, ok });

    // Signed links
    const query = new URLSearchParams(await signLink("s3cret", { t: "appr_abc", d: "approve", w: "Sam Lee", l: "Approve GitHub?", e: "dev" }));
    const p = query.get("p")!;
    const s = query.get("s")!;
    check("valid link verifies", (await verifyLink("s3cret", p, s))?.d === "approve");
    check("wrong secret rejected", (await verifyLink("other", p, s)) === null);
    const forged = btoa(JSON.stringify({ t: "appr_abc", d: "reject", w: "Sam Lee", l: "x", e: "dev" })).replace(/=+$/, "");
    check("edited payload rejected", (await verifyLink("s3cret", forged, s)) === null);

    // Roles and checklists
    check("role match is case-insensitive", findRole(" engineering ") === "Engineering");
    check("unknown role is null", findRole("Marketing") === null);
    check("manager by name", findManager("dana ortiz") === "dana");
    check("non-manager rejected", findManager("Alex Kim") === null);
    check("every role item exists", Object.values(ROLES).flat().every((id) => !!getItem(id)));
    check("engineering gets GitHub + common items", ["github", "badge", "security-awareness"].every((id) => checklistFor("Engineering").some((i) => i.id === id)));
    check("every owner/backup is a person", checklistFor("Engineering").concat(checklistFor("Sales"), checklistFor("Support")).every((i) => PEOPLE[i.owner] && PEOPLE[i.backup]));
    check("timings increase", TIMINGS.remindAfterHours < TIMINGS.escalateAfterHours && TIMINGS.escalateAfterHours < TIMINGS.stallAfterHours);

    // Policy guardrails
    const docs = [{ name: "Time Off Policy", text: "Full-time employees receive **15 days** of paid time off per calendar year.", link: "" }];
    check("exact quote verified", unverifiedQuotes([{ doc: "Time Off Policy", text: "Full-time employees receive 15 days of paid time off" }], docs).length === 0);
    check("altered quote caught", unverifiedQuotes([{ doc: "Time Off Policy", text: "Full-time employees receive 20 days of paid time off" }], docs).length === 1);
    check("quote from unknown doc caught", unverifiedQuotes([{ doc: "Other", text: "Full-time employees receive 15 days of paid time off" }], docs).length === 1);
    check("salary question is sensitive", sensitiveTopic("When is my salary reviewed?") !== null);
    check("PTO question is not sensitive", sensitiveTopic("How many vacation days do I get?") === null);

    // Dashboard
    const hires = [{ "Hire ID": "H1", "New Hire": "A", "Start Date": "2026-01-10", Status: "In progress", Manager: "Sam Lee" }];
    const tasks = [
      { "Hire ID": "H1", Item: "GitHub", Status: "Done", Due: "2026-01-08" },
      { "Hire ID": "H1", Item: "Laptop", Status: "Waiting", Due: "2026-01-07" },
      { "Hire ID": "H1", Item: "Slack", Status: "Stalled", Due: "2026-01-08" },
    ];
    const [before] = buildViews(hires, tasks, new Date("2026-01-08T12:00:00Z"));
    check("percent ready", before?.percent === 33);
    check("overdue item flagged", !!before?.flags.some((f) => f.startsWith("Laptop: overdue")));
    check("stalled counts as missed before start", before?.missed === 1);
    const [after] = buildViews(hires, tasks, new Date("2026-01-11T12:00:00Z"));
    check("open item missed after start", after?.missed === 2);

    const failed = results.filter((r) => !r.ok);
    logger.info(`Self-test: ${results.length - failed.length}/${results.length} passed`, { failed: failed.map((f) => f.name) });
    if (failed.length) throw new Error(`Failed: ${failed.map((f) => f.name).join("; ")}`);
    return { passed: results.length };
  },
});
