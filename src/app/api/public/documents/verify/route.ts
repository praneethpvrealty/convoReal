import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

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
    if (!storedPassword || storedPassword.toLowerCase() !== password.trim().toLowerCase()) {
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

    return NextResponse.json({
      success: true,
      documents: parsedDocuments,
    });
  } catch (err) {
    console.error("[POST /api/public/documents/verify] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
