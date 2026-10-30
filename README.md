# Employee Onboarding Agent

Takes a new hire from signed offer to fully set up. It builds the right checklist for their role, collects every approval by email with one-click links, chases anything that stalls, and answers employees' policy questions from approved documents only.

Built with TypeScript on [Trigger.dev](https://trigger.dev), Claude, Gmail, Google Sheets and Drive, plus a small Cloudflare Worker for the approval links. The demo company is a made-up one, "Northwind Labs".

## How it works

1. **Offer signed.** HR sets an offer to *Signed* in the **Offers** tab. `onboarding-check-offers` picks it up (every 15 minutes) and checks that it can start, for example that the role is known. If it can't, it goes to "Needs HR review".
2. **One run per hire.** `onboard-hire` writes the checklist for the role to the **Tasks** tab and starts one child run per item: laptop, accounts, access to each system.
3. **Approvals in parallel.** For each system, the hiring manager approves, then the system owner approves, then the owner creates the account and clicks *Mark provisioned*. Each step is an email with Approve and Reject links. The automation requests and records, and never creates an account itself.
4. **Nothing gets forgotten.** An unanswered request gets a reminder, then is escalated, then is marked stalled. A withdrawn offer cancels its runs and closes its open items.
5. **Daily digest.** Each manager gets a weekday 8am email with what's waiting on them.
6. **Policy helpdesk.** Employees email questions to a helpdesk address. Claude answers only from the approved policy docs in a Drive folder (`policies/` has five examples). Anything not clearly covered, or sensitive, is passed to HR or IT.

## Design choices

- **Long waits cost nothing.** A hire's run can last days. Trigger.dev checkpoints the waits, so nothing is billed while it waits for an approval.
- **Signed links.** Approval links are signed with a secret and checked by the Cloudflare Worker in `relay/` before anything happens, so a link can't be forged or edited to point at another item.
- **Safe retries.** Sheet rows are keyed, so a retried run never adds duplicates.
- **Demo speed.** `DEMO_TIME_SCALE=720` turns a 24-hour wait into 2 minutes, so the full reminder → escalation → stalled cycle fits into one demo. Production always runs in real time.
- **One file to change the company.** Roles, checklists, people, owners and timings live in `src/trigger/onboarding/config/company.ts`.

## Project layout

```
src/trigger/onboarding/
  check-offers.ts       finds signed or withdrawn offers
  onboard-hire.ts       one orchestrator run per hire
  assign-item.ts        one checklist item
  request-access.ts     manager → owner → provisioned
  policy-inbox.ts       helpdesk answers from approved docs
  daily-digest.ts       weekday summary for managers
  config/company.ts     roles, checklists, people, timings
relay/                  Cloudflare Worker for one-click approvals
policies/               sample policy documents
```

## Running it

Step-by-step setup (about 30 minutes, all free tiers) is in [SETUP.md](SETUP.md). Start with `onboarding-self-test`, which needs no accounts.
