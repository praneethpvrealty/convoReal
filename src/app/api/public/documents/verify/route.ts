import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { trackDocumentView } from "@/lib/documents/track-view";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function passwordMatches(stored: string, supplied: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DOC_VERIFY_LIMIT = { limit: 8, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { token, password } = body;

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    const rate = checkRateLimit(`doc-verify:${token}:${getClientIp(request)}`, DOC_VERIFY_LIMIT);
    if (!rate.success) return rateLimitResponse(rate);

    const admin = supabaseAdmin();
    // Look up doc request by share token
    const { data: docRequest, error } = await admin
      .from("property_document_requests")
      .select("*, property:properties(id, title, property_code, documents)")
      .eq("share_token", token)
      .maybeSingle();

    if (error || !docRequest) {
      return NextResponse.json({ error: "Invalid share link" }, { status: 404 });
    }

    if (docRequest.status !== "approved") {
      return NextResponse.json({ error: "This link is not approved" }, { status: 403 });
    }

    // Check expiry
    const expiresAt = docRequest.share_token_expires_at
      ? new Date(docRequest.share_token_expires_at)
      : null;
    const isExpired = expiresAt ? new Date() > expiresAt : false;
    if (isExpired) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    // Verify password
    const storedPassword = docRequest.access_password?.trim();
    if (!storedPassword || !passwordMatches(storedPassword, password.trim())) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const property = docRequest.property as any;
    const dbDocs: string[] = Array.isArray(property?.documents)
      ? property.documents.filter((d: string) => d?.trim())
      : [];

    const parsedDocuments = dbDocs.map((doc: string) => {
      if (doc.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(doc);
          return { url: parsed.url || "", title: parsed.title || "" };
        } catch {
          // fall through
        }
      }
      return { url: doc, title: "" };
    }).filter(d => d.url.length > 0);

    // Best-effort: never let view tracking block the recipient's access.
    void trackDocumentView(admin, {
      id: docRequest.id,
      account_id: docRequest.account_id,
      requester_phone: docRequest.requester_phone,
      viewed_at: docRequest.viewed_at,
      view_count: docRequest.view_count ?? 0,
      last_viewed_at: docRequest.last_viewed_at,
    });

    return NextResponse.json({
      success: true,
      documents: parsedDocuments,
    });
  } catch (err) {
    console.error("[POST /api/public/documents/verify] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
