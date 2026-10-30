// The dummy company: people, systems, equipment, training, and which role gets what.
// Edit this file to change checklists or owners; the tasks read everything from here.

/** IANA timezone for the 8am daily digest, e.g. "Asia/Manila" or "America/New_York". */
export const TIMEZONE = "UTC";

/** Reminder → escalate → stall timings, in real hours (DEMO_TIME_SCALE shrinks them for demos). */
export const TIMINGS = {
  remindAfterHours: 24,
  escalateAfterHours: 48,
  stallAfterHours: 120,
};

export type Person = { name: string; title: string; /** Gmail +alias, so every dummy person's mail lands in your inbox. */ alias: string };

export const PEOPLE = {
  dana: { name: "Dana Ortiz", title: "Sales Director", alias: "dana" },
  sam: { name: "Sam Lee", title: "Engineering Manager", alias: "sam" },
  maya: { name: "Maya Patel", title: "Support Lead", alias: "maya" },
  jamie: { name: "Jamie Fox", title: "HR Partner", alias: "hr" },
  alex: { name: "Alex Kim", title: "IT Operations", alias: "it" },
  robin: { name: "Robin Hale", title: "Head of IT", alias: "itlead" },
  jordan: { name: "Jordan Reyes", title: "Revenue Operations", alias: "revops" },
  chris: { name: "Chris Wong", title: "Platform Engineering", alias: "platform" },
  riley: { name: "Riley Chen", title: "Support Operations", alias: "supportops" },
  morgan: { name: "Morgan Blake", title: "Facilities", alias: "facilities" },
  taylor: { name: "Taylor Brooks", title: "Learning & Development", alias: "learning" },
} as const satisfies Record<string, Person>;

export type PersonId = keyof typeof PEOPLE;

/** Hiring managers, as written in the Offers tab's "Hiring Manager" column. */
export const MANAGERS: PersonId[] = ["dana", "sam", "maya"];

/** Gets unknown roles, stalled items, rejections, policy hand-offs, and backs up silent managers. */
export const HR: PersonId = "jamie";
/** Gets IT policy hand-offs. */
export const IT_HELPDESK: PersonId = "alex";

export type ItemKind = "access" | "equipment" | "training";

export type ChecklistItem = {
  id: string;
  name: string;
  kind: ItemKind;
  /** System owner (access) or the person who does the task (equipment, training). */
  owner: PersonId;
  /** Gets the escalation when the owner doesn't respond. */
  backup: PersonId;
  /** Due this many days before the start date. */
  dueDaysBeforeStart: number;
};

const ITEMS = {
  workspace: { name: "Google Workspace (email)", kind: "access", owner: "alex", backup: "robin", dueDaysBeforeStart: 2 },
  slack: { name: "Slack", kind: "access", owner: "alex", backup: "robin", dueDaysBeforeStart: 2 },
  hubspot: { name: "HubSpot CRM", kind: "access", owner: "jordan", backup: "robin", dueDaysBeforeStart: 2 },
  github: { name: "GitHub", kind: "access", owner: "chris", backup: "robin", dueDaysBeforeStart: 2 },
  aws: { name: "AWS (dev account only)", kind: "access", owner: "chris", backup: "robin", dueDaysBeforeStart: 2 },
  jira: { name: "Jira", kind: "access", owner: "alex", backup: "robin", dueDaysBeforeStart: 2 },
  zendesk: { name: "Zendesk", kind: "access", owner: "riley", backup: "robin", dueDaysBeforeStart: 2 },
  "laptop-mba": { name: "Laptop: MacBook Air", kind: "equipment", owner: "alex", backup: "robin", dueDaysBeforeStart: 3 },
  "laptop-mbp": { name: "Laptop: MacBook Pro", kind: "equipment", owner: "alex", backup: "robin", dueDaysBeforeStart: 3 },
  "laptop-win": { name: "Laptop: Windows", kind: "equipment", owner: "alex", backup: "robin", dueDaysBeforeStart: 3 },
  badge: { name: "ID badge", kind: "equipment", owner: "morgan", backup: "jamie", dueDaysBeforeStart: 1 },
  "sales-training": { name: "Training: Sales onboarding", kind: "training", owner: "taylor", backup: "jamie", dueDaysBeforeStart: 1 },
  "eng-security-training": { name: "Training: Secure engineering", kind: "training", owner: "taylor", backup: "jamie", dueDaysBeforeStart: 1 },
  "support-tools-training": { name: "Training: Support tools", kind: "training", owner: "taylor", backup: "jamie", dueDaysBeforeStart: 1 },
  "security-awareness": { name: "Training: Security awareness", kind: "training", owner: "taylor", backup: "jamie", dueDaysBeforeStart: 1 },
} as const satisfies Record<string, Omit<ChecklistItem, "id">>;

export type ItemId = keyof typeof ITEMS;

/** Every role gets these as well. */
const COMMON: ItemId[] = ["security-awareness", "badge"];

export const ROLES: Record<string, ItemId[]> = {
  Sales: ["workspace", "slack", "hubspot", "laptop-mba", "sales-training"],
  Engineering: ["workspace", "slack", "github", "aws", "jira", "laptop-mbp", "eng-security-training"],
  Support: ["workspace", "slack", "zendesk", "jira", "laptop-win", "support-tools-training"],
};

export function getItem(id: string): ChecklistItem {
  const item = (ITEMS as Record<string, Omit<ChecklistItem, "id">>)[id];
  if (!item) throw new Error(`Unknown checklist item "${id}"`);
  return { id, ...item };
}

/** The role's name as written in ROLES (case-insensitive match), or null if it isn't one. */
export function findRole(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return Object.keys(ROLES).find((role) => role.toLowerCase() === wanted) ?? null;
}

/** A hiring manager by name or id (case-insensitive), or null. */
export function findManager(input: string): PersonId | null {
  const wanted = input.trim().toLowerCase();
  return MANAGERS.find((id) => id === wanted || PEOPLE[id].name.toLowerCase() === wanted) ?? null;
}

export function checklistFor(role: string): ChecklistItem[] {
  const items = ROLES[role];
  if (!items) throw new Error(`Unknown role "${role}"`);
  return [...items, ...COMMON].map(getItem);
}

export function person(id: PersonId): Person {
  return PEOPLE[id];
}
