import { logger, task } from "@trigger.dev/sdk";
import { PEOPLE } from "./config/company.js";
import { gmailSettings } from "./lib/mail.js";
import { Store, TABS } from "./lib/store.js";
import { addDays, isoDate } from "./lib/time.js";

/**
 * Run once (free): creates every tab with its layout, and adds four demo offers with status "Sent"
 * if the Offers tab is empty. Change a row's Offer Status to "Signed" to start that onboarding.
 */
export const setupSheet = task({
  id: "onboarding-setup-sheet",
  run: async () => {
    const store = await Store.open();
    for (const tab of Object.values(TABS)) await store.layout(tab);

    const seeded = (await store.rows(TABS.offers)).length === 0;
    if (seeded) {
      const [local, domain] = gmailSettings().user.split("@");
      const personal = (alias: string) => `${local}+${alias}@${domain}`;
      const today = new Date();
      await store.append(TABS.offers, [
        { "Offer ID": "OF-1001", "New Hire": "Priya Shah", "Personal Email": personal("priya"), Role: "Engineering", "Hiring Manager": PEOPLE.sam.name, "Start Date": isoDate(addDays(today, 10)), "Offer Status": "Sent" },
        { "Offer ID": "OF-1002", "New Hire": "Marco Diaz", "Personal Email": personal("marco"), Role: "Sales", "Hiring Manager": PEOPLE.dana.name, "Start Date": isoDate(addDays(today, 12)), "Offer Status": "Sent" },
        { "Offer ID": "OF-1003", "New Hire": "Aisha Bello", "Personal Email": personal("aisha"), Role: "Support", "Hiring Manager": PEOPLE.maya.name, "Start Date": isoDate(addDays(today, 14)), "Offer Status": "Sent" },
        // Not a role in config/company.ts: shows the "Needs HR review" path.
        { "Offer ID": "OF-1004", "New Hire": "Tom Becker", "Personal Email": personal("tom"), Role: "Marketing", "Hiring Manager": PEOPLE.dana.name, "Start Date": isoDate(addDays(today, 14)), "Offer Status": "Sent" },
      ]);
      await store.fit(TABS.offers);
    }
    logger.info("Sheet ready", { seeded });
    return { tabs: Object.values(TABS), seeded };
  },
});
