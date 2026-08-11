# Translation review

The Indic copy in `src/lib/whatsapp/template-copy.ts` was drafted by a
machine. These sheets exist so someone who actually speaks the language
can check it before it reaches a buyer under your brand.

One sheet per language, each showing the English source beside the
current translation with a blank column for corrections:

| Language | Sheet |
|----------|-------|
| हिन्दी (Hindi) | [`hi.md`](./hi.md) |
| ಕನ್ನಡ (Kannada) | [`kn.md`](./kn.md) |
| தமிழ் (Tamil) | [`ta.md`](./ta.md) |
| తెలుగు (Telugu) | [`te.md`](./te.md) |
| മലയാളം (Malayalam) | [`ml.md`](./ml.md) |
| मराठी (Marathi) | [`mr.md`](./mr.md) |

Sixteen strings per language — 9 button labels and 7 message bodies.

## The two things people confuse

Reviewing a sheet does **not** unblock anything on its own. There are
two separate steps and they answer different questions:

1. **Is the shipped copy good?** — answered by these sheets. A
   correction becomes an edit to `template-copy.ts` and a PR, which
   fixes the wording for *every* account.

2. **Does this brokerage accept it for their own sends?** — answered in
   the app. The gate is `message_templates.translation_reviewed_at`, a
   per-account row, set by **Mark reviewed** in
   Settings → WhatsApp → Templates. Until that is set, the submit route
   refuses to send the translation to Meta and every message falls back
   to English.

So: review the sheet, land any corrections, deploy, then mark reviewed
per template in the app and submit.

**Ordering trap:** editing a template body in the app clears an
existing sign-off (the trigger from migration 248). Edit first, then
mark reviewed.

## Why the copy must stay dull

The enquiry-family messages are deliberately flat — labelled fields, no
emoji, no persuasive call to action. That flatness is what keeps Meta
classifying them as **Utility**, which is exempt from the per-user
marketing cap that silently drops Marketing sends (error 131049).

A reviewer who "warms up" the wording can get the template
re-categorised as Marketing on approval, and per `AGENTS.md` §2.7 that
is **unfixable** — Meta will not change an approved template's
category, and re-submitting under a new name burns the name for four
weeks. Tell every reviewer this before they start.

## Regenerating

The sheets are generated, not hand-written. After any change to
`template-copy.ts`:

```bash
npm run export:translation-review
```

They are committed so a reviewer's corrections can come back as an
ordinary PR, and so a diff shows when the copy changed but the sheets
did not.
