# Post-call follow-up — design

What happens on WhatsApp after a voice call ends, decided by what the
call actually produced. Written to be reused by every outbound calling
flow, not only buyer qualification: the next one is cold-calling
property owners to onboard them, and it should need a playbook, not a
new mechanism.

Built: phases A–D ship (dispositions in
`src/lib/outreach/dispositions.ts`, playbooks in
`src/lib/outreach/playbooks.ts`, the dispatcher and its gates in
`src/lib/outreach/dispatcher.ts`, the `post_call_options` opener as an
engine template, `outreach_followups` in migration 281, the hourly
sweep at `/api/cron/outreach-followups`, and the Call Analytics tab
reading it all back). Phase E — owner onboarding — awaits its
playbook. `docs/voice-agent-integration-plan.md` covers the calling
itself, which ships.

---

## 1. The gap this closes

Today a qualification call ends and the lead hears nothing more. The
Engine writes a call log, tags the contact, updates their requirement
and fires a Radar event — all of it agent-facing. The person who just
spent three minutes on the phone gets silence.

That silence is the whole opportunity. A lead who says "14.7 is out of
my range, I'm at 8–9 in HSR" has just handed over a qualified
requirement and a reason to be helped. Ninety seconds later they should
have three listings that fit, from a named person, on WhatsApp.

The second, larger prize is the lead who is real but **not now** —
"after Diwali", "once my flat sells". Nothing in the product currently
survives that answer. They are the reason to build the dated half of
this: the goal is that when they become serious, ConvoReal is who they
message, because it was the one that stayed useful while they were not
buying.

---

## 2. The constraint that shapes everything

**A phone call does not open a WhatsApp window.** Meta's 24-hour
customer service window opens on an inbound _WhatsApp_ message
(`src/lib/whatsapp/customer-window.ts`). A voice conversation, however
warm, leaves it shut. So the first message after a call is a
**template**, and templates are the scarcest resource in this product:

- Category is assigned by Meta on first approval and is **unfixable**
  (root `AGENTS.md` §2.7). Four attempts at an agent digest all came
  back Marketing; each attempt burned a name permanently.
- Marketing templates are **silently dropped** for any recipient at
  their per-user marketing cap — error 131049. A batch looks successful
  and reaches part of the list. `src/lib/reengagement/template-gate.ts`
  already encodes this: approved _and_ Utility is the only combination
  that reaches everyone.

The design consequence is firm: **do not build a template per
disposition.** A dozen dispositions with a dozen Marketing templates is
a dozen chances to be silently dropped, and a dozen names spent.

### The shape that works

One opener template per flow, carrying a button. The tap is an inbound
message, which **opens the 24-hour window** — and everything rich
happens after it, free-form and unmetered:

```
call ends
   ↓
opener template  ("Thanks for speaking with us just now, {{1}}.
                  Shall I send you options at {{2}}?")   [Yes, send them]
   ↓ tap = inbound message = window opens
rich follow-up   photos, three matched listings, a PDF, a voice note,
                 the agent's number, a site-visit slot picker
```

This is the same control-reply pattern the codebase already runs on
(`src/lib/whatsapp/control-reply-ids.ts`), and it inverts the economics:
one approved template buys an unlimited, media-rich conversation.

Where the window is _already_ open — the lead messaged in the last 24
hours, which is common for portal leads mid-conversation — skip the
opener entirely and send the rich follow-up directly.

---

## 3. Every outcome a qualification call can produce

Two layers. The provider reports whether the call connected; the agent
reports what was said. Both arrive in the same webhook payload
(`docs/sarvam-voice-agent-setup.md` §3).

### 3.1 Connection outcomes — already modelled

| Outcome              | What it means            | Follow-up                                                                                            |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `connected`          | someone talked           | §3.2 decides                                                                                         |
| `no_answer`          | rang out                 | nothing on attempt 1–2; after the last attempt, a "tried to reach you" opener with a callback button |
| `busy`               | engaged                  | nothing — the dispatcher retries                                                                     |
| `voicemail`          | machine answered         | treat as no_answer; never leave the pitch to a machine                                               |
| `wrong_number`       | not the lead             | nothing. Flag the contact's number as suspect so nobody dials it again                               |
| `callback_requested` | asked to be called later | confirm the callback in writing, and schedule it                                                     |

### 3.2 Conversation dispositions — what the call was actually for

The rich half. Each maps to a follow-up, a contact-state change, and
sometimes a dated re-engagement.

| Disposition              | The lead said                                                             | Follow-up                                                        | State                                                 |
| ------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `qualified`              | price works, still interested                                             | listing pack + agent intro + offer a site visit                  | HOT, task for agent                                   |
| `budget_mismatch_open`   | too expensive, but show me alternatives                                   | **three matched listings at their stated budget** — the 95% case | requirement saved, WARM, Radar                        |
| `budget_mismatch_closed` | too expensive, not interested                                             | one gracious close, no pitch                                     | COLD                                                  |
| `requirement_changed`    | wants something else entirely (rent not buy, another city, plot not flat) | acknowledge the new requirement, matches if we have them         | requirement replaced                                  |
| `not_now`                | real, but later — "after Diwali", "once my flat sells"                    | thank + **ask when to check back**, then go quiet                | dated re-engagement at the stated date; the long game |
| `already_bought`         | done, bought elsewhere                                                    | congratulate, offer to help with the next one                    | CLOSED, do not re-enrol                               |
| `just_browsing`          | never a real enquiry                                                      | nothing beyond a polite close                                    | COLD                                                  |
| `wants_site_visit`       | asked to see it                                                           | slot options + location + agent contact                          | appointment intent, task                              |
| `wants_details`          | brochure, floor plan, RERA, price break-up                                | send exactly what was asked for                                  | document request                                      |
| `wants_human`            | "put me on to a person"                                                   | agent intro, and a task on that agent within the hour            | escalation                                            |
| `language_barrier`       | could not converse                                                        | retry in the language they used, or hand to a human              | flag language                                         |
| `do_not_call`            | asked not to be contacted                                                 | **nothing on WhatsApp either**                                   | `do_not_call`, opted out                              |
| `is_agent_broker`        | a broker, not a buyer                                                     | different conversation entirely — channel partner                | tag, out of the buyer funnel                          |
| `has_property_to_sell`   | owner with inventory                                                      | **supply, not demand** — route to owner onboarding               | lead source flip                                      |

Two of those repay attention:

**`not_now` is the point of the exercise.** It is the most common
honest answer from a real buyer and the one the product currently
throws away. Capturing _when_ and going quiet until then is what earns
the callback months later.

**`has_property_to_sell` is free supply.** A call placed to qualify
demand routinely surfaces a seller. That is the owner-onboarding flow
arriving through the qualification flow's front door, and it is the
clearest argument for building this mechanism flow-agnostic.

---

## 4. Mechanism

Four pieces, each reusable.

**1. Disposition, derived not invented.** The voice agent already
returns `qualification` and `requirement`. Extend it with an explicit
`disposition` from the closed set above, and normalise in
`parseVoiceCallPayload` the way `outcome` is normalised now — unknown
values fall back to a safe default rather than inventing behaviour.

**2. Playbooks in code, not in a table.** A playbook is
`(flow_kind, disposition) → actions`. Pure TypeScript, versioned in git,
unit-testable against every disposition — the same choice
`ENGINE_TEMPLATES` and the automation engine already make. Flow kinds:
`buyer_qualification` now, `owner_onboarding` next, and whatever
follows.

**3. A dispatcher with the safety rules in one place.** Every send goes
through it, and it checks, in order: do-not-call and marketing opt-out;
whether the window is open (free-form) or shut (opener template);
`canSendToEveryLead()` on the template before relying on it; dedupe, so
a redelivered webhook cannot double-message; and credits where a send
costs any.

**4. Dated re-engagement for `not_now` and `callback_requested`.** A
row with a `scheduled_for`, swept by a cron, honouring the same gates.
The follow-up nudges table (migration 272) already carries
`snoozed_until` for a related purpose; this is that idea generalised to
the lead rather than the agent.

Proposed storage — one table, flow-agnostic:

```
outreach_followups
  account_id, contact_id, call_log_id
  flow_kind        buyer_qualification | owner_onboarding | …
  disposition
  status           pending | sent | opened | completed | skipped | failed
  scheduled_for    null = send now; a date = the long game
  template_used, window_was_open, sent_at, opened_at, skip_reason
```

`skip_reason` matters as much as `sent_at`: a follow-up not sent
because a template was Marketing-capped, or because the lead opted out,
should be visible rather than absent.

---

## 5. What "wow" actually means here

Worth stating, because it is easy to build the mechanism and send
something forgettable through it.

- **Specific, not grateful.** "You mentioned 8–9 Cr around HSR — here
  are three that fit" beats "Thank you for your time" every time. The
  call already produced the specifics; the message must use them.
- **Named.** From `{{agent_name}}`, with a number that reaches them —
  both now travel with the call.
- **Fast.** Within minutes, while the conversation is still in mind.
- **Ends with one clear thing to do.** A button, not a paragraph.
- **Quiet when the answer was no.** The lead who said "not now" and
  then heard nothing for four months is the one who comes back. A
  follow-up cadence that ignores their answer destroys exactly the
  relationship this is meant to build.

---

## 6. Phasing

- **A — the spine.** Disposition in the payload and parser, the
  `outreach_followups` table, the dispatcher with its gates, and the
  playbook interface. One disposition wired end to end
  (`budget_mismatch_open`, the 95% case) to prove the shape.
- **B — the opener template.** One per flow, worded for Utility, gated
  on `canSendToEveryLead()`, with the button that opens the window.
  Submit once and live with the category (§2.7).
- **C — the rest of the qualification playbook**, including the
  matched-listing pack, which `src/lib/matching.ts` already produces.
- **D — the long game.** `scheduled_for`, the sweep cron, and the
  "when shall I check back?" capture that feeds it.
- **E — owner onboarding**, as a second `flow_kind`. If it needs
  anything but a new playbook and a new opener template, phase A got
  the abstraction wrong.

---

## 7. Open questions for the build session

- **Does the opener earn its cost?** Every no-answer lead who never taps
  the button still consumed a template send. Worth measuring tap rate
  before enrolling every disposition.
- **Who writes the copy?** The messages carry the brokerage's voice, not
  ours. A per-account override on the playbook copy, or a fixed set
  with parameters?
- **How long is the long game?** A `not_now` at "after Diwali" is
  four months out. One check-in, or a slow cadence? One, unless the
  lead engages — see §5.
- **Should `has_property_to_sell` auto-create the owner record**, or
  raise a task for a human to make that call?
