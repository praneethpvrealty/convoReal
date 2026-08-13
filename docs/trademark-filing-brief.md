# Trademark filing brief — CONVOREAL (India)

**Status: preparation, not a filing.** This is the brief to hand a trademark
attorney, or to work from if filing directly on the IP India portal. Nothing
here has been filed.

**Not legal advice.** Fees, classification wording and procedure change; every
figure below carries its source and should be re-checked at filing time. The
knock-out search in §3 is the step most worth paying a professional for.

---

## 1. Why this, and why it is the best-value protection available

The concern this answers is "someone clones the repo and undercuts us."

Copyright over the code does not solve that — the code was published under MIT
and cannot be un-published. A **trademark does**: a cloner may lawfully run the
code, and still may not call the result ConvoReal, use the logo, or buy ads
against the name. Customers search for the name, not the source.

It is also the cheapest item on the list by a wide margin — government fees
below are per class, against a rebuild costed at a quarter of engineering.

---

## 2. What to register

### 2.1 The mark

**CONVOREAL** — word mark, plain characters.

File the **word mark first**. A word mark protects the name in any font,
colour or styling; a logo (device) mark protects only that artwork. If the logo
matters commercially, file it as a **separate second application** rather than a
composite — a composite mark is weaker, because protection attaches to the
combination rather than to the word on its own.

### 2.2 Classes

Software is split across classes depending on how it is delivered. ConvoReal is
a hosted product with a companion mobile app, so:

| Class | Covers | Needed? |
|---|---|---|
| **42** | Software as a service (SaaS), platform as a service, software design and development | **Yes — primary.** This is what ConvoReal actually is |
| **9** | Downloadable software and mobile applications | **Yes.** The Expo app in `mobile/` is downloadable software |
| 35 | Business management, advertising, marketing services | Optional — see below |
| 36 | Real estate services (agency, brokerage) | **Probably not** — see below |

**On Class 35.** Justifiable if you present the product as delivering marketing
or business-management services (broadcast campaigns, lead management). It
broadens protection against a cloner positioning as a "real estate marketing
platform". It is the usual third class for SaaS. Costs one more class fee.

**On Class 36.** Avoid unless you intend to act as a broker yourself. You supply
software *to* brokerages; you do not transact property. Filing in a class you do
not trade in invites a non-use cancellation after five years and adds cost for
protection you cannot defend.

**Recommendation: file 42 + 9.** Add 35 if budget allows and you want the wider
perimeter.

### 2.3 Draft specification of goods and services

Wording matters — too narrow and a cloner sidesteps it, too broad and the
examiner objects. Starting point, for an attorney to refine:

**Class 42**
> Software as a service (SaaS) featuring software for customer relationship
> management, property inventory management, lead management and sales pipeline
> management for the real estate sector; platform as a service (PaaS) featuring
> software for messaging-based customer engagement; design, development and
> maintenance of computer software; hosting of web portals for the display of
> real estate listings; providing temporary use of non-downloadable software for
> matching prospective buyers with property listings.

**Class 9**
> Downloadable mobile applications for customer relationship management,
> property inventory management and sales pipeline management; downloadable
> computer software for messaging-based customer engagement in the real estate
> sector; recorded computer programs for data matching and analysis.

**Class 35** (only if filing it)
> Business management assistance for real estate agencies; advertising and
> marketing services provided via messaging platforms; compilation and
> systemisation of information into computer databases; lead generation
> services.

The 13th edition of the Nice Classification took effect on 1 January 2026 and
revised SaaS and AI terminology in Class 42 — make sure the attorney is working
from the current edition.

---

## 3. Before filing — the knock-out search

**Do this first. It is the step that decides whether the money is well spent.**

A web search found no conflicting "ConvoReal" in software or trademarks, but a
web search is a weak signal and proves nothing. The real check is:

1. **IP India public search** — `tmrsearch.ipindia.gov.in`. Search Classes 42, 9
   (and 35 if filing) for:
   - the exact word CONVOREAL
   - **phonetically similar** marks — India's examiners apply phonetic
     similarity seriously. Try CONVOREEL, KONVOREAL, CONVOREALTY, CONVO REAL,
     and CONVO-prefixed marks generally in software classes
   - CONVO alone, which is a common prefix and the likeliest source of a
     citation
2. **MCA company name search** — a registered company with a confusingly similar
   name is a separate risk to the mark.
3. **Domain and social handles** — you hold `convoreal.com`; check the obvious
   variants are not held by someone trading in the same space.
4. **Common-law use** — an unregistered prior user in India can defeat a
   registration. Plain web and app-store searching covers this.

If a CONVO-prefixed software mark exists in Class 42, get advice before filing
rather than after the examination report.

---

## 4. Applicant and fees

### 4.1 Who applies

This decides the fee, so settle it before filing.

| Applicant | Government fee, e-filing, **per class** |
|---|---|
| Individual, startup, or MSME | **₹4,500** |
| Company or LLP | **₹9,000** |

Physical filing costs ₹500 more per class in either category. Fees are set by
the First Schedule to the Trade Marks Rules, 2017, and are non-refundable.

**The concession is not automatic.** The ₹4,500 rate requires a valid **Udyam
Registration Certificate** held *at the time of filing* Form TM-A, or DPIIT
startup recognition. If ConvoReal is not yet Udyam-registered, do that first —
registration is free and online, and it halves the fee on every class.

The concession applies to the initial application only, not renewals.

### 4.2 Indicative total

Two classes (42 + 9) at the MSME rate: **₹9,000 in government fees**, plus
attorney fees. Three classes: ₹13,500 plus attorney fees. Attorney charges vary
widely; get two quotes.

### 4.3 Documents

- Applicant identity and address proof
- **Udyam or DPIIT certificate**, if claiming the reduced fee
- Form TM-48 — power of attorney, if an attorney files for you
- Logo file, only if filing a device mark
- **Date of first use in commerce** — see §5, this one matters

---

## 5. Claim actual first use, not "proposed to be used"

The single most common own goal in an Indian filing.

Form TM-A asks whether the mark is *proposed to be used* or already in use. India
protects prior use, and rights run from the **date of first use**, not the date
of filing. ConvoReal has been trading under the name — live site, paying
customers, WhatsApp templates approved against the brand — so claiming
"proposed to be used" throws away real priority.

**Establish and record the earliest defensible date**, and keep evidence for it:

- earliest deployment of `convoreal.com`
- first customer invoice or subscription
- domain registration record
- earliest commit renaming the product to ConvoReal — the repository history is
  contemporaneous and dated, which is unusually good evidence
- Meta/WhatsApp Business account under the name

An affidavit of use plus this evidence supports the claim.

---

## 6. Process and timeline

Roughly, and it varies:

1. **File TM-A** → application number issued immediately. From this point you may
   use **™** next to the mark.
2. **Formalities check** → weeks.
3. **Examination report** → a few months. Objections under §9 (descriptiveness)
   or §11 (similar earlier marks) are common and usually answerable.
4. **Reply to examination report** → one month deadline. Do not miss it.
5. **Hearing**, if the reply does not clear it.
6. **Publication in the Trade Marks Journal** → four-month opposition window.
7. **Registration** → certificate. **®** may then be used.

Total, uncontested: commonly 12–24 months. Contested: longer.

Registration lasts 10 years and is renewable indefinitely.

**Use ™ from the day you file.** It costs nothing and signals a claim. Do not use
® until registration is granted — misuse is an offence.

---

## 7. A note on "Portfolio"

`AGENTS.md` records **Portfolio** as the customer-facing brand for the `/den`
and `/buyer` portals.

Do not expect to register that. It is an ordinary English word, directly
descriptive of what the feature shows, and already crowded across financial and
software classes. It is fine as a feature name inside a ConvoReal product — the
protection sits on CONVOREAL, and the feature name rides on it.

If a portal-level brand ever needs its own protection, it needs a distinctive
coined word, not a dictionary one.

---

## 8. After registration

- **Watch for infringers.** A registration is only worth what you enforce. A
  trademark watch service, or a periodic search of the register and app stores.
- **Keep using it.** A mark unused for five continuous years is vulnerable to
  cancellation. Ordinary trading is enough.
- **Diarise the renewal** at 10 years.
- Consider filing in other jurisdictions only if you actually trade there.
  Madrid Protocol makes that cheaper later, from the Indian base.

---

## Sources

- [Trademark Registration Fees India (2026) — Intepat](https://www.intepat.com/blog/trademark-registration-fees-india)
- [MSME Trademark Registration India: ₹4,500 fee & filing guide — Intepat](https://www.intepat.com/blog/trademark-registration-for-msme)
- [Trademark Class 42: IT, Software & Research Services — LegalWiz](https://www.legalwiz.in/blog/trademark-class-42-technology-research-and-software-services)
- [Trademark Classes in India — strategic class selection (2026) — Unimarks Legal](https://unimarkslegal.com/various-classes-classifications-trademark-registration/)
- [Trademark Class 42: IT, Software Development, SaaS, Design — My Legal Pal](https://mylegalpal.com/trademark-classes/class-42/)
