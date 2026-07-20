import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { BRANDING } from "@/config/branding";
import { AI_FEATURE_COSTS } from "@/lib/credits/types";

// GET /api/config
// Deployment-level client configuration for surfaces that can't read
// the web bundle's env (the mobile app): site branding and AI feature
// credit costs. Auth-gated like every other non-public route.
export async function GET() {
  try {
    await requireRole("viewer");

    return NextResponse.json({
      data: {
        branding: { name: BRANDING.name },
        ai_costs: AI_FEATURE_COSTS,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
