/**
 * Structural guard for Meta's 24-hour customer service window.
 *
 * The window is enforced in `sendWhatsAppMessageAndPersist` — the one
 * point every ordinary sender funnels through — because Meta accepts a
 * re-engagement send, returns a wamid, then fails it asynchronously with
 * 131047. A module that calls `sendTextMessage` from `meta-api.ts`
 * directly skips that check and can put a delivery-failure bubble in a
 * customer's thread.
 *
 * The modules below predate the guard and are exempt for a stated
 * reason. This test pins the list: a NEW direct caller fails here, so
 * the choice to bypass the dispatcher is made deliberately in review
 * rather than by copy-paste.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Why each of these may send free-form text without the dispatcher:
 * every one is either replying inside an open window (the contact just
 * messaged, which is what triggered the code) or is an OTP/system path
 * that selects a template first and only falls back to text.
 */
const ALLOWED_DIRECT_SENDERS = [
  // Replies to an inbound WhatsApp message — the window is open by
  // construction, since the inbound message is what invoked these.
  "src/lib/ai/chatbot-engine.ts",
  "src/lib/whatsapp/webhook-handler.ts",
  "src/lib/calendar/whatsapp-scheduler.ts",
  // Template-first paths that keep a text fallback.
  "src/app/api/auth/sms-hook/route.ts",
  "src/app/api/leads/email-webhook/auto-reply.ts",
  "src/lib/whatsapp/admin-otp-sender.ts",
  // The dispatcher itself — where the guard lives.
  "src/lib/whatsapp/meta-api-dispatcher.ts",
].sort();

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

describe("free-form WhatsApp senders", () => {
  it("only the known modules reach sendTextMessage without the dispatcher", () => {
    const root = process.cwd();
    const callers = sourceFiles(join(root, "src"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /from ['"]@\/lib\/whatsapp\/meta-api['"]/.test(source) &&
          /\bsendTextMessage\b/.test(source)
        );
      })
      .map((file) => file.slice(root.length + 1))
      .sort();

    expect(callers).toEqual(ALLOWED_DIRECT_SENDERS);
  });

  it("the dispatcher enforces the window on free-form text", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/whatsapp/meta-api-dispatcher.ts"),
      "utf8",
    );
    expect(source).toMatch(/isWithinCustomerWindow/);
    expect(source).toMatch(/CUSTOMER_WINDOW_EXPIRED_MESSAGE/);
  });
});
