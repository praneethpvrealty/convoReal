import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { POPULAR_PROJECTS } from "@/lib/data/real-estate-data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lookupProject, type ProjectSource } from "@/lib/projects/ai-discovery";

interface DbProject {
  name: string;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  project_type: string | null;
  source: ProjectSource | null;
}

// GET /api/projects
// Searches real estate projects from RERA database, falling back to local seed data
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || searchParams.get("query") || "";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 10, 50) : 10;

    let dbProjects: DbProject[] = [];

    if (search.trim()) {
      const cleanSearch = search.trim().replace(/"/g, '\\"');
      const pattern = `"%${cleanSearch}%"`;
      const { data, error } = await ctx.supabase
        .from("rera_projects")
        .select("name, sublocality, city, state, address, project_type, source")
        .or(`name.ilike.${pattern},sublocality.ilike.${pattern}`)
        .limit(limit);

      if (error) {
        console.error("[GET /api/projects] Database error:", error);
      } else {
        dbProjects = (data as DbProject[]) || [];
      }
    }

    const term = search.trim();
    if (dbProjects.length === 0 && term.length >= 4) {
      try {
        const found = await lookupProject(term);
        if (found) {
          const admin = supabaseAdmin();
          const { data: existing } = await admin
            .from("rera_projects")
            .select("name, sublocality, city, state, address, project_type, source")
            .ilike("name", found.name.replace(/[\\%_]/g, (c) => `\\${c}`))
            .limit(1)
            .maybeSingle();
          if (existing) {
            dbProjects.push(existing as DbProject);
          } else {
            const { error: insertError } = await admin.from("rera_projects").insert(found);
            if (insertError) {
              console.error("[GET /api/projects] Failed to save AI-discovered project:", insertError);
            }
            dbProjects.push(found);
          }
        }
      } catch (err) {
        console.warn("[GET /api/projects] AI project lookup failed:", err);
      }
    }

    // Merge/format the projects. If we have database results, map them.
    // Otherwise fallback to filtering the static POPULAR_PROJECTS list.
    let results = dbProjects.map(p => ({
      name: p.name,
      sublocality: p.sublocality || "",
      city: p.city || "Bangalore",
      state: p.state || "Karnataka",
      address: p.address || "",
      type: p.project_type || "Flat/ Apartment",
      source: p.source,
    }));

    if (results.length === 0) {
      // Filter POPULAR_PROJECTS static array
      const searchLower = term.toLowerCase();
      const filteredPopular = searchLower
        ? POPULAR_PROJECTS.filter(p => 
            p.name.toLowerCase().includes(searchLower) || 
            p.sublocality.toLowerCase().includes(searchLower)
          )
        : POPULAR_PROJECTS;
      
      results = filteredPopular.slice(0, limit).map(p => ({
        name: p.name,
        sublocality: p.sublocality,
        city: p.city,
        state: p.state,
        address: p.address,
        type: "Flat/ Apartment",
        source: "curated" as ProjectSource,
      }));
    }

    return NextResponse.json(results);
  } catch (err) {
    return toErrorResponse(err);
  }
}
