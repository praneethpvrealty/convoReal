// ============================================================
// POST /api/webhooks/token-safe — escrow partner webhook.
//
// Forward-looking integration point for a licensed escrow provider
// (Escrowpay / Castler / bank escrow APIs). Verifies an HMAC-SHA256
// signature over the raw body against TOKEN_SAFE_WEBHOOK_SECRET,
// resolves the escrow by provider_ref, applies the state transition
// idempotently, and appends the payload to the escrow's webhook_log
// audit trail. Fails CLOSED (503) when no secret is configured.
//
// Expected payload shape (adapted per partner at integration time):
//   { "reference": "<provider_ref>", "event": "funded"|"released"|"refunded"|"disputed" }
// ============================================================

import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { denAdmin } from "@/lib/den/auth";

const EVENT_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  funded: { from: ["accepted"], to: "funded" },
  released: { from: ["funded", "disputed"], to: "released" },
  refunded: { from: ["funded", "disputed"], to: "refunded" },
  disputed: { from: ["funded"], to: "disputed" },
};

export async function POST(request: Request) {
  const secret = process.env.TOKEN_SAFE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "token-safe webhook not configured" }, { status: 503 });
  }

  const signature =
    request.headers.get("x-token-safe-signature") ||
    request.headers.get("x-webhook-signature") ||
    "";
  const bodyText = await request.text();
  const expected = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");
  let valid = false;
  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json({ error: "Signature mismatch" }, { status: 401 });
  }

  let payload: { reference?: string; event?: string };
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reference = payload.reference;
  const event = payload.event;
  if (!reference || !event || !EVENT_TRANSITIONS[event]) {
    return NextResponse.json({ error: "Missing or unknown reference/event" }, { status: 400 });
  }

  const db = denAdmin();
  const { data: escrow } = await db
    .from("token_escrows")
    .select("id, status, webhook_log, deal_room_id")
    .eq("provider_ref", reference)
    .maybeSingle();
  if (!escrow) {
    return NextResponse.json({ error: "Unknown reference" }, { status: 404 });
  }

  const transition = EVENT_TRANSITIONS[event];
  const terminal = ["released", "refunded"].includes(transition.to);
  const log = Array.isArray(escrow.webhook_log) ? escrow.webhook_log : [];

  // Conditional update = idempotent: a replayed webhook whose
  // transition already happened only appends to the audit log.
  const { data: updated } = await db
    .from("token_escrows")
    .update({
      status: transition.to,
      updated_at: new Date().toISOString(),
      ...(transition.to === "funded" ? { funded_at: new Date().toISOString() } : {}),
      ...(terminal ? { resolved_at: new Date().toISOString() } : {}),
      webhook_log: [...log, { event, reference, received_at: new Date().toISOString() }],
    })
    .eq("id", escrow.id)
    .in("status", transition.from)
    .select("id")
    .maybeSingle();

  if (!updated) {
    await db
      .from("token_escrows")
      .update({
        webhook_log: [
          ...log,
          { event, reference, received_at: new Date().toISOString(), applied: false },
        ],
      })
      .eq("id", escrow.id);
    return NextResponse.json({ ok: true, applied: false });
  }

  if (transition.to === "released") {
    await db
      .from("deal_rooms")
      .update({ status: "token_secured", updated_at: new Date().toISOString() })
      .eq("id", escrow.deal_room_id)
      .eq("status", "open");
  }

  return NextResponse.json({ ok: true, applied: true });
}
