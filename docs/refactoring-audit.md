# Codebase Refactoring Audit

A ranked list of the places where the codebase has outgrown its own rules, with the measurements that put each one on the list. Re-count before acting on a number; every figure here drifts with each feature.

The first audit (early 2026) named three items. All three shipped: the WhatsApp send-and-persist logic lives in `src/lib/whatsapp/meta-api-dispatcher.ts` and the automation, flow, reminder and broadcast callers are thin wrappers over it; `src/app/api/whatsapp/webhook/route.ts` is a 130-line entry point; currency formatting has a home in `src/lib/currency-utils.ts`. The complexity moved rather than disappeared, which is what the list below records.

## Done

| Item                                                                                                                                                                                                                                                                                                                                                                                                                 | Shipped in                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| One service-role client factory. Five modules exported their own singleton under five names and eighteen more built one inline. All of them now call `supabaseAdmin()`, and `convoreal/no-inline-service-role-client` fails any other read of the key.                                                                                                                                                               | `release/refactor-guardrails`                               |
| Shared auth helpers in every route. Twenty-five routes resolved the caller with a raw `auth.getUser()`, eleven of them re-implementing the super-admin check beside `requirePlatformAdmin()`. `convoreal/no-raw-auth-in-routes` keeps it that way.                                                                                                                                                                   | `release/refactor-guardrails`                               |
| Prettier enforced. The config said single quotes, semicolons and an 80-column width; about 1,200 files under `src/`, `mobile/`, `docs/`, `e2e/` and the root disagreed in one way or another, and CI never ran `format:check`. It does now, in the `lint` job. `mcp/` keeps its own toolchain and is ignored, as it already was for ESLint.                                                                          | `release/refactor-guardrails`                               |
| One rupee formatter. Thirty-five local `formatPrice` / `formatINR` / `formatRupees` / `formatBudget` variants, plus the mobile copy, now resolve to `src/lib/format/currency.ts`: `formatInrCompact` for lists, cards, digests and bot replies, `formatInrPlain` for whole-rupee totals, `formatCurrency` for listing prices. The mobile bundle imports the same file through `@shared/`.                            | `release/formatters-counts`                                 |
| One aggregate for the Contacts tabs. The contacts screen issued six `count: 'exact'` queries per load and the mobile tab four, with the staff and won-deal rules written differently on each side. Both read `contacts_tab_counts` now (migration 20261003174500).                                                                                                                                                   | `release/formatters-counts`                                 |
| The inbound WhatsApp chain is a list of steps. `handleInboundChain` was 2,100 lines of 44 sequential branches sharing mutable locals; it is now `src/lib/whatsapp/inbound/chain/`: a context built once, 41 step files each returning `handled` or `continue`, and `steps/index.ts` holding the order. The dedicated reply handlers moved to `src/lib/whatsapp/inbound/` first. `webhook-handler.ts` is 1,690 lines. | `agent/inbound-handlers-split`, `agent/inbound-chain-steps` |

## Open, in order

### 1. God components without tests

| File                                                 | Lines | `useState` | Direct queries or fetches |
| ---------------------------------------------------- | ----- | ---------- | ------------------------- |
| `src/components/inventory/property-form.tsx`         | 7,686 | 144        | 26                        |
| `src/components/contacts/contact-detail-view.tsx`    | 4,160 | 89         | 40                        |
| `src/components/showcase/showcase-view.tsx`          | 3,998 |            |                           |
| `src/components/inventory/property-share-dialog.tsx` | 3,659 |            |                           |
| `src/app/(dashboard)/contacts/contacts-content.tsx`  | 3,195 | 52         | 36                        |

None has a sibling test. Split the property form into section components over one reducer-backed form-state hook. Move each screen's reads into react-query hooks: 63 client files already use react-query, 24 still hand-roll the effect-plus-fetch-plus-state triple the handbook forbids.

### 2. Web and mobile each own the same query

Mobile holds 183 direct Supabase reads across 52 files. The contacts list is the sharpest case: the web file selects the buyer-consent columns with a comment explaining why they must travel, and the mobile file selects a different column list without them. Give the contacts list, contact detail and agent detail a shared API route or a shared column spec under `src/lib/`, and point both surfaces at it.

### 3. Chatbot engine

`src/lib/ai/chatbot-engine.ts` is 3,876 lines with 70 direct queries and one test file. Move the draft-session reads and writes into repository functions and leave the engine with prompt assembly and the decision tree.

### 4. Typing

147 `as unknown as` casts, 147 casts to `Record<string, unknown>`, 53 explicit-any suppressions, and no generated Supabase types: `src/types/index.ts` is 1,655 hand-maintained lines. Generate `database.types.ts` and type the clients; the casts retire as rows become typed.

### 5. Smaller items

- Nine client files under `src/app/(dashboard)` exceed 800 lines, and `calendar/page.tsx` is a 2,110-line page file rather than a server page wrapping client content.
- Each chain step still writes its own Supabase queries; the next pass on `src/lib/whatsapp/inbound/chain/steps/` is to give the biggest steps (lead-conversation, lead-question, specific-property-interest, shared-contacts) their own unit tests over a stubbed context.
- Seven single `count: 'exact'` calls remain in browser code, each on an action rather than a page load (the inventory star cap, pipeline deletion, audience sizing, journey sheets). The mobile dashboard still issues eight on load; fold them into one aggregate the way the web dashboard did in migration 169.
- `getInitials` has three copies, `truncate` two, and `normalizePhone` two (`src/lib/deals/stakeholders.ts` versus `src/lib/whatsapp/phone-utils.ts`), where divergence is a correctness risk.
- Hook files mix kebab-case (`use-auth.tsx`) and camelCase (`useCredits.ts`); §2.4 asks for camelCase.
- `src/lib/whatsapp/` holds 105 files flat, thirteen of them `template-*`. Subfolders for templates, digests and inbound handlers, done alongside item 1.
- 1,467 bare `console.error` calls and no logger.
- A NUL byte sits inside a template literal at line 134 of `src/lib/contacts/parties.ts` as a map-key separator. It works, and it makes grep treat the file as binary; write it as `\u0000`.

## Measuring again

```bash
# largest non-test files
find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' -exec wc -l {} + | sort -rn | head -40
# exact counts in browser code
grep -rn "count: 'exact'" src/components src/hooks src/app --include='*.tsx' --include='*.ts' | grep -v '/api/' | grep -v '\.test\.'
# rupee formatters outside the shared module (should be the price-band and masking helpers only)
grep -rnE "(function|const) [a-zA-Z]*(Inr|INR|Rupee|Price|Budget)[A-Za-z]*\s*(=|\()" src mobile/lib --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v 'src/lib/format/currency.ts' | grep -iE "format|label"
# routes still off the shared auth helpers (should be the lint exemptions only)
grep -rl "auth.getUser()" src/app/api --include=route.ts
```
