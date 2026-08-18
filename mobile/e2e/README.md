# Mobile UI regression tests

The Maestro flow checks the contact-note composer with the Android keyboard open. It expects an authenticated development build with the provisioned Sandeep Kotecha fixture.

```bash
npx maestro test e2e/maestro/contact-notes-keyboard.yaml
```

The assertion deliberately targets the submit control after typing. If the keyboard covers the composer or the screen fails to resize and scroll, Maestro cannot tap it and the flow fails.

The buyer-requirement flow checks the contact-card entry point and verifies that the send
sheet clearly identifies the connected ConvoReal channel before any message is sent.

```bash
npx maestro test e2e/maestro/buyer-requirement-request.yaml
```
