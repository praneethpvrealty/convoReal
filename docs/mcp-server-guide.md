# ConvoReal MCP server — what it's for and how to use it

This guide is for **agents, brokerage owners and operators**. For the package
internals, see [`mcp/README.md`](../mcp/README.md).

---

## What it is, in one paragraph

MCP (Model Context Protocol) is a standard way to attach a real system to an AI
client. The ConvoReal MCP server attaches **one workspace** — its inventory,
contacts, matching engine, pipeline, agenda and Portfolio portals — to a client
such as Claude Desktop. You then ask questions in plain language and the client
calls ConvoReal for the answer instead of guessing.

It reads through the same API the mobile app uses and runs the same matching
engine as the dashboard. Nothing is recomputed, re-scored or reinterpreted on
the way out, so **what the assistant tells you and what the app shows you cannot
disagree**.

---

## Why it's worth having

**It answers cross-screen questions in one step.** "Which of my buyers fit the
Kokapet villa, and which of them haven't been contacted in a month?" spans
Inventory, Contacts and the matching engine. In the app that's three screens and
some mental arithmetic. Here it is one question.

**It puts the matching engine where the thinking happens.** The engine
(`src/lib/matching.ts`) is the part of ConvoReal a spreadsheet cannot replace —
it weighs property type, locality, budget, BHK, rental yield and named projects,
and explains itself. The MCP server exposes **both directions** of it, so an
agent can ask "who wants this?" and "what should I show them?" without opening
anything.

**It turns the numbers into sentences.** "How much of my owners' stock is still
unsold and what's it worth?" is a real question with a real answer that no screen
currently shows in one place.

**It is read-first by design.** Twelve of the sixteen tools only read. The three
that write create a contact, append a note, or make a task — nothing that
reaches a customer. See [Boundaries](#boundaries).

---

## Requirements

| | |
|---|---|
| Plan | **Agency** — API access is an Agency-plan feature |
| Role | **Admin or owner**, to create the API key |
| On your machine | Node.js 20+, and an MCP client (e.g. Claude Desktop) |

---

## Setup

### 1. Create an API key

Keys are per workspace, scoped, and revocable. Go to **Settings → API Keys**,
click **New key**, name it after the tool that will use it, and copy the key
when it appears.

That is the only time it is ever shown. ConvoReal stores only a hash of it, so
it cannot be recovered later — if you lose it, revoke that key and create
another.

Give each tool its own key. Shared keys cannot be revoked independently, and
"last used" stops telling you anything useful.

Start with `["read"]`. Add `"write"` only if you want the assistant creating
contacts, notes and tasks.

### 2. Build the server

```bash
cd mcp
npm install
npm run build
```

### 3. Point your client at it

Claude Desktop, in `claude_desktop_config.json`:

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

Restart the client. You should see 16 ConvoReal tools available.

If the server does not appear, run it by hand — it prints the reason and what to
do about it:

```bash
CONVOREAL_API_KEY=cvr_sk_… node mcp/dist/index.js
```

---

## What to actually ask it

The value is in questions that cross screens. These are worked examples: the
question, what happens underneath, and what comes back.

### Working a new listing

> **"We just listed a 3BHK in Kokapet at 2.1 crore. Who should I call?"**

Searches inventory for the listing, then ranks every buyer and agent contact
against it with the real engine. You get a list ordered by score with the reason
each person is on it — "Type you asked for · In your area · Within budget" —
plus their phone number and stated requirement.

Follow up with *"which of those haven't been contacted in the last month?"* and
it filters on `last_contacted_at` without another search.

### Working a buyer

> **"Asha Rao is coming in tomorrow. What should I show her?"**

Finds the contact, reads her brief, and ranks available inventory against it.
Only listings you can actually transact are considered — sold, archived and
off-market stock is excluded, so nothing embarrassing surfaces.

If she has no stated budget or area, it says so instead of ranking your whole
inventory against nothing. That is deliberate: a ranking with no brief behind it
is noise wearing the costume of an answer.

### Starting the day

> **"What's on today, and is anything overdue?"**

Appointments and open to-dos in one call. Overdue tasks are always included
regardless of the window, because a task due last week is still outstanding.

### Triage

> **"What's sitting in Match Radar that nobody has acted on?"**

The unresolved feed — listings and buyers the engine has already paired. Radar
snapshots are computed when the event fires and are **not** recomputed on read,
so ask for a fresh ranking before acting on an old one. The tool description
tells the assistant this, so it usually re-checks on its own.

### The owner book

> **"How much of my owners' stock is still for sale, and what's it worth?"**

Owner counts split across available / under contract / sold / published, the
total and average asking price of what is still available, and open bids.

> **"Which owner has the most unsold inventory?"**

Owners ranked by live stock, with the value sitting behind each one.

### The buyer book

> **"What's my buyers' average budget?"**

Average, median, and the full range across buyers who have stated one — plus how
many have said they have *no* ceiling, counted separately rather than dragged
through the average as zeros.

> **"Who are my biggest buyers and are they actively shortlisting?"**

Buyers ranked by budget with their shortlist size, so you can see who is engaged
versus who is only large on paper.

### Pipeline

> **"What are my biggest open deals and when are they expected to close?"**

Deals with stage, pipeline, linked contact and property.

### Writing things down (needs `write`)

> **"Log that Vikram wants to see the Narsingi plot on Saturday, and remind me to call him Friday."**

Appends a note to Vikram's contact record and creates a task linked to him. Both
land where your team will see them, not just in a chat transcript.

---

## The sixteen tools

| Area | Tools |
|---|---|
| Inventory | `search_properties`, `get_property`, `match_contacts_for_property` |
| Contacts | `search_contacts`, `get_contact`, `match_properties_for_contact`, `list_contact_notes`, **`create_contact`**, **`add_contact_note`** |
| Workspace | `list_radar_events`, `list_deals`, `get_agenda`, **`create_todo`** |
| Portfolio | `get_portfolio_summary`, `list_portfolio_owners`, `list_portfolio_buyers` |

All prefixed `convoreal_`. **Bold** = requires the `write` scope. Full parameter
reference in [`mcp/README.md`](../mcp/README.md).

---

## Things that will otherwise surprise you

**Prices are in rupees, not lakhs or crores.** "Under 1.5 crore" is
`max_price: 15000000`. The tool descriptions say so, so clients usually get it
right — but if a result looks a factor of 100 wrong, this is why.

**Portfolio numbers stay at zero until people log in.** They count owners and
buyers who have verified their WhatsApp number on the `/den` and `/buyer`
portals. No portal logins means zeros — working correctly, not broken.

**A null average is not zero.** If nobody has stated a budget, the average is
omitted rather than shown as ₹0. Same for asking prices when nothing is
available.

**Agent-referred listings don't count toward an owner.** On those the owner field
holds the *referring agent*, so counting them would credit the wrong person.
They are excluded from owner stock and bid counts.

**Radar is a snapshot, not a live score.** See [Triage](#triage) above.

---

## Boundaries

Deliberate, not missing:

- **Nothing WhatsApp-facing.** No sending, no broadcasts, no template
  submissions. Meta's template rules and the 24-hour window are unforgiving and
  a misfired send costs your WABA quality rating. Sending stays a deliberate
  action in the app.
- **No billing, credits or member management.**
- **No deletes.** The only writes are create-contact, append-note, create-task.
- **No other tenant's data**, and nothing behind a `/den` or `/buyer` login. The
  Portfolio tools report on *your own* linked owners and buyers — people already
  in your contact list.

---

## Security

The key is a **bearer credential for one workspace**. Anyone holding it can read
that workspace's inventory and contacts.

- Treat it like a password. Keep it out of version control and out of screenshots.
- Issue **read-only** unless a write tool is genuinely needed.
- Revoke immediately if it leaks: `DELETE /api/account/api-keys/<id>`. Revocation
  takes effect on the next request.
- Only the hash is stored, so a lost key is rotated, never recovered.
- Records created through a key are attributed to the admin who issued it.
- Give each client its own key. Shared keys cannot be revoked independently, and
  `last_used_at` stops telling you anything useful.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server missing from the client | Bad path or key | Run `node mcp/dist/index.js` by hand; it prints the reason |
| `402 plan_upgrade_required` | Workspace is not on Agency | Upgrade, or use the app |
| `401 Invalid API key` | Revoked, expired, or mistyped | Issue a new key |
| `403 insufficient_scope` | Read-only key, write tool | Issue a key with `["read","write"]` |
| `429` | More than 120 calls/minute | Ask fewer, broader questions |
| Empty Portfolio numbers | No portal logins yet | Expected — see above |
