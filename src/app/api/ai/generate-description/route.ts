import { NextRequest, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { generateText } from "@/lib/ai/gemini";
import { checkPlanLimit, gateResponse } from "@/lib/billing/gates";
import { burnCredits } from "@/lib/credits/burn";
import { AI_FEATURE_COSTS } from "@/lib/credits/types";

// POST /api/ai/generate-description
// Generates property listing description using Gemini 2.5 Flash
export async function POST(request: NextRequest) {
  try {
    // Security: Only logged-in agents or admins can perform AI generation tasks
    const ctx = await requireRole("agent");

    // Plan gate: AI requires Solo Pro or higher
    const gate = await checkPlanLimit(ctx, "ai");
    if (!gate.allowed) return gateResponse(gate);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API Key is not configured. Please add GEMINI_API_KEY in your .env.local file and restart the dev server." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { title, type, location, bedrooms, bathrooms, area, areaUnit, frontage, depth, features } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Property title is required to generate description" }, { status: 400 });
    }

    // Build context parameters for property specifications
    let detailsStr = `Property Type: ${type || "Not Specified"}\n`;
    if (location) detailsStr += `Location: ${location}\n`;
    if (bedrooms) detailsStr += `Bedrooms: ${bedrooms}\n`;
    if (bathrooms) detailsStr += `Bathrooms: ${bathrooms}\n`;
    
    if (area) {
      detailsStr += `Area: ${area} ${areaUnit || "Sq.Ft."}\n`;
    }
    if (frontage && depth) {
      detailsStr += `Land Dimensions: Frontage ${frontage} Ft, Depth ${depth} Ft\n`;
    }
    
    if (features && Array.isArray(features) && features.length > 0) {
      detailsStr += `Key Features & Amenities: ${features.join(", ")}\n`;
    }

    const systemInstruction =
      "You are a professional real estate marketing copywriter. Create compelling, engaging, and professional property descriptions that highlight key selling points. Keep the tone sophisticated, inviting, and clear.";

    const prompt =
      `Write an elegant and attractive marketing description for a real estate listing based on the following details:\n\n` +
      `Title: ${title}\n` +
      `${detailsStr}\n` +
      `The description should be around 100-150 words. Focus on the benefits of the space, design quality, features, and location. Do not include placeholders like '[Insert Name]'.`;

    // Burn before the external call, per credit engine convention —
    // never charge for a call that didn't happen, never skip
    // charging one that did.
    const burn = await burnCredits(ctx.accountId, "property_description", AI_FEATURE_COSTS.property_description, {
      client: ctx.supabase,
    });
    if (!burn.success) {
      return NextResponse.json(
        {
          error: "Insufficient credits for AI description generation.",
          creditsNeeded: AI_FEATURE_COSTS.property_description,
          upgradeRequired: true,
        },
        { status: 402 },
      );
    }

    const description = await generateText(prompt, systemInstruction);

    return NextResponse.json({ description });
  } catch (err) {
    return toErrorResponse(err);
  }
}
