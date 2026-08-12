# ConvoReal MCP server

Exposes one ConvoReal workspace — inventory, contacts, the matching engine, pipeline and agenda — to an MCP client such as Claude Desktop.

It is a **client of `/api/v1`** and nothing more: no database connection, no Supabase key, no business logic. Scoring, filtering and tenancy live in the Next.js app, so what this server reports and what the dashboard shows cannot drift apart.

> **Using it, rather than working on it?** Read
> [`docs/mcp-server-guide.md`](../docs/mcp-server-guide.md) instead — what to ask
> it, worked examples, and troubleshooting. This file is the package reference.

**Requires the Agency plan.** API access is an Agency-tier feature
(`PLAN_CONFIG` in `src/lib/billing/plan-config.ts`). Key creation is gated, and
entitlement is re-checked on every request, so a downgrade deactivates existing
keys rather than grandfathering them.

---

## Setup

### 1. Create an API key

In ConvoReal, go to **Settings → API Keys** (admin or owner, Agency plan) and
create one. The key is shown **once** — copy it then.

`POST /api/account/api-keys` is the same thing over HTTP:

```json
{ "name": "Claude Desktop", "scopes": ["read"] }
```

Read-only is the default and the right choice unless you specifically want the three write tools. Add `"write"` to the scopes array if you do.

### 2. Build

```bash
cd mcp
npm install
npm run build
```

### 3. Point your client at it

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "convoreal": {
      "command": "node",
      "args": ["/absolute/path/to/convoReal/mcp/dist/index.js"],
      "env": {
        "CONVOREAL_API_KEY": "cvr_sk_…",
        "CONVOREAL_BASE_URL": "https://www.convoreal.com"
      }
    }
  }
}
```

| Variable             | Required | Default                     | Notes                                                                    |
| -------------------- | -------- | --------------------------- | ------------------------------------------------------------------------ |
| `CONVOREAL_API_KEY`  | yes      | —                           | Starts with `cvr_sk_`. A Supabase token will not work.                   |
| `CONVOREAL_BASE_URL` | no       | `https://www.convoreal.com` | Origin only — no path. Use `http://localhost:3000` against a dev server. |

---

## Tools

### Inventory

| Tool                                    | What it does                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `convoreal_search_properties`           | Search inventory by text, city, type, listing type, status, price band, bedrooms. Prices are in **rupees**, not lakhs or crores. |
| `convoreal_get_property`                | One listing in full — description, area breakdown, per-sqft rate, possession date.                                               |
| `convoreal_match_contacts_for_property` | Rank buyers and agents against one listing.                                                                                      |

### Contacts

| Tool                                     | What it does                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `convoreal_search_contacts`              | Search by name, phone, email, company; filter by type, lead temperature, whether they have an active requirement. |
| `convoreal_get_contact`                  | One contact with their full stated brief.                                                                         |
| `convoreal_match_properties_for_contact` | Rank available inventory against one buyer's brief.                                                               |
| `convoreal_list_contact_notes`           | The free-form history an agent keeps on a contact.                                                                |
| `convoreal_create_contact`               | **write** — add a contact. Refuses to duplicate an existing phone number.                                         |
| `convoreal_add_contact_note`             | **write** — append a note. Append-only; no edit or delete.                                                        |

### Workspace

| Tool                          | What it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `convoreal_list_radar_events` | The Match Radar feed of unresolved listing↔buyer matches.              |
| `convoreal_list_deals`        | Pipeline deals with stage, contact and property.                       |
| `convoreal_get_agenda`        | Appointments and open to-dos for a date window, in one call.           |
| `convoreal_create_todo`       | **write** — create a task, optionally linked to a contact or property. |

### Portfolio (the owner and buyer portals)

| Tool                                | What it does                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `convoreal_get_portfolio_summary`   | Both sides at once: owner stock and its value, buyer budget distribution, bid and shortlist activity. |
| `convoreal_list_portfolio_owners`   | Owners with a portal login, ranked by live stock.                                               |
| `convoreal_list_portfolio_buyers`   | Buyers with a portal login, ranked by budget.                                                   |

Only portal users **linked to this workspace** are visible. `den_users` and
`buyer_users` are global identities — one person may deal with several
agencies — so every query enters through the account-scoped link table
(`den_contact_links` / `buyer_contact_links`). A person registered with two
agencies contributes to each one's numbers separately, and neither can see the
other's link.

Two distinctions the summary preserves, because collapsing them would mislead:

- A buyer marked **unconstrained** has explicitly said they have no budget
  ceiling. They are counted separately, never averaged in as zero.
- A **null** average means nobody has stated a budget at all — different from
  an average of zero, and rendered as an omitted line rather than `₹0`.

Every tool takes `response_format` (`markdown`, the default, or `json`) and every list tool takes `limit` and `offset`.

### The two matching tools are the point

`convoreal_match_contacts_for_property` and `convoreal_match_properties_for_contact` run ConvoReal's own engine (`src/lib/matching.ts`) — the same scoring behind the inventory screen, the share dialog, Match Radar and the buyer portal. They weigh property type, locality, budget, bedroom count, rental yield and named projects of interest, and return a score out of 100 with per-field verdicts and plain-language reasons.

They are the transpose of each other and share one implementation, so an agent's answer and a buyer's portal can never disagree about what counts as a match.

---

## What this server deliberately cannot do

Not an oversight — a boundary:

- **Nothing WhatsApp-facing.** No sending a message, launching a broadcast, or submitting a template. Meta's template rules and the 24-hour window are unforgiving, and a misfired send costs the account's WABA quality rating. Sending stays a deliberate action in the app.
- **No billing, credits or member management.**
- **No portal user's private session data.** The Portfolio tools report on the account's *own* linked owners and buyers — the same people already in its contact list. They cannot reach a portal identity the account has not linked, another agency's link to the same person, or anything behind a `/den` or `/buyer` login.
- **No cross-tenant Deal Mode inventory.** Match Radar `deal_mode` events reference another tenant's property and are legible only through a masked snapshot; they are filtered out of `convoreal_list_radar_events` entirely.
- **No deletes.** The only writes are creating a contact, appending a note, and creating a task.

---

## Development

```bash
npm run dev        # tsx watch
npm run typecheck
npm test           # 37 tests: a real MCP client over an in-memory
                   # transport against a real HTTP stub of /api/v1
npm run build
```

The package has its own dependency tree and is excluded from the root `tsconfig.json`, ESLint config and Vercel build, so root `npm run typecheck && npm run lint && npm test` does not cover it. Run the commands above when changing anything under `mcp/`.

---

## Security notes

- The key is a **bearer credential scoped to one workspace**. Anyone holding it can read that workspace's inventory and contacts. Treat it like a password: keep it out of version control, and revoke it in Settings → API keys the moment it leaks.
- Keys carry `read` or `read` + `write`. Issue read-only unless a write tool is actually needed.
- Only the SHA-256 hash of a key is stored server-side; a lost key is rotated, not recovered.
- Records created through a key are attributed to the admin who issued it.
- A `402 plan_upgrade_required` on every call means the workspace is not on the Agency plan; the key itself is fine.
- The server writes logs to **stderr** only. stdout is the protocol channel — anything written there corrupts the session.
