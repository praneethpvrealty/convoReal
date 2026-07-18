import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { generateJson } from '@/lib/ai/gemini';
import { sanitizeStages } from '@/lib/liaisons/workflows';

const SYSTEM_INSTRUCTION =
  'You are an expert on Indian real-estate procedures — government paperwork ' +
  '(khata, registration, EC, mutation, conversion), builder processes, home loans, ' +
  'and property taxation (TDS for resident and NRI sellers). Karnataka/Bengaluru ' +
  'conventions apply where the process is state-specific (BBMP, Kaveri portal, SRO).\n' +
  'Given a process name (and optional extra context), produce a stage-by-stage ' +
  'workflow that a real-estate agent can send to a CLIENT on WhatsApp so the ' +
  'client understands what happens, who approves each step, and how long it takes.\n' +
  'Return a JSON object with this exact structure:\n' +
  '{\n' +
  '  "service_name": "Clean title for the process",\n' +
  '  "description": "One or two client-facing sentences introducing the process",\n' +
  '  "stages": [\n' +
  '    {\n' +
  '      "name": "Stage name, e.g. ARO verification & approval",\n' +
  '      "authority": "Who acts or approves at this stage (e.g. Case worker, ARO, JD, DC, Builder, Bank credit team, Sub-Registrar) or null",\n' +
  '      "duration_days": Indicative duration in whole days (number) or null when it truly varies,\n' +
  '      "description": "One client-facing sentence about what happens in this stage or null"\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  'Rules:\n' +
  '1. 3 to 12 stages, in strict chronological order.\n' +
  '2. Write for the client, not the case worker — plain language, no internal jargon without expansion (expand abbreviations like ARO once).\n' +
  '3. Durations are indicative working-day estimates; never promise exact dates.\n' +
  '4. Mention required documents inside stage descriptions where natural.\n' +
  '5. Do not invent fees or statutory rates that change over time; describe the step ("stamp duty is paid") without hardcoding percentages unless they are stable and essential.\n' +
  '6. Output MUST be valid JSON matching the schema.';

function stripFences(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
  }
  return cleaned;
}

// POST /api/liaison-workflows/generate — draft a workflow with AI.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    // AI call — same posture as copilot chat, tighter than adminAction.
    const limit = checkRateLimit(
      `liaisonWorkflowGen:${ctx.userId}`,
      RATE_LIMITS.copilotChat,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { process, details } = body;

    // Validation
    if (typeof process !== 'string' || process.trim().length === 0) {
      return NextResponse.json({ error: "'process' is required" }, { status: 400 });
    }

    const prompt =
      `Draft the client-facing workflow for this process:\n\n"${process.trim().slice(0, 300)}"` +
      (typeof details === 'string' && details.trim()
        ? `\n\nExtra context from the agent:\n"${details.trim().slice(0, 1000)}"`
        : '');

    const raw = await generateJson(prompt, SYSTEM_INSTRUCTION, {
      feature: 'liaison_workflow_generate',
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripFences(raw)) as Record<string, unknown>;
    } catch {
      console.error('[POST /api/liaison-workflows/generate] Unparseable AI response:', raw);
      return NextResponse.json(
        { error: 'AI returned an unreadable draft — please try again.' },
        { status: 502 },
      );
    }

    const stages = sanitizeStages(parsed.stages);
    if (stages.length === 0) {
      return NextResponse.json(
        { error: 'AI could not draft stages for this process — try adding more detail.' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      service_name:
        typeof parsed.service_name === 'string' && parsed.service_name.trim()
          ? parsed.service_name.trim()
          : process.trim(),
      description:
        typeof parsed.description === 'string' ? parsed.description.trim() || null : null,
      stages,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
