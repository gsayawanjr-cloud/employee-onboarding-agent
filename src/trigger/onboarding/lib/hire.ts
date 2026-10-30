import type { PersonId } from "../config/company.js";

/** One new hire, as passed from check-offers to the onboarding run and its item runs. */
export type Hire = {
  offerId: string;
  name: string;
  role: string;
  managerId: PersonId;
  /** YYYY-MM-DD */
  startDate: string;
  signedAt: string;
};

export type ItemPayload = { hire: Hire; itemId: string };

/** How an item ended. Only "Done" counts toward ready. */
export type ItemOutcome = { itemId: string; status: "Done" | "Rejected" | "Stalled"; detail: string };
