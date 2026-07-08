import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { POPULAR_PROJECTS } from "@/lib/data/real-estate-data";
import { generateText } from "@/lib/ai/gemini";
import { createClient } from "@supabase/supabase-js";

interface DbProject {
  name: string;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  project_type: string | null;
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
        .select("name, sublocality, city, state, address, project_type")
        .or(`name.ilike.${pattern},sublocality.ilike.${pattern}`)
        .limit(limit);

      if (error) {
        console.error("[GET /api/projects] Database error:", error);
      } else {
        dbProjects = (data as DbProject[]) || [];
      }
    }

    // Dynamic Discovery / Self-Learning: If no projects match and the query is reasonably specific
    const term = search.trim();
    if (dbProjects.length === 0 && term.length >= 4) {
      const apiKey = process.env.GEMINI_API_KEY;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (apiKey && serviceKey && dbUrl) {
        try {
          console.log(`[GET /api/projects] Project not found in DB. Resolving dynamically via Gemini: "${term}"`);
          const prompt = `Identify the real estate project (apartment, villa, or layout/plot) matching the query: "${term}" in Bangalore or its outskirts.
Provide its details in a JSON object with the following fields:
- name: (Project name, e.g. "SJR Blue Waters" or "Swiss Town")
- promoter_name: (Builder name, e.g. "SJR Primecorp" or "Swiss Infrastructure")
- project_type: (Must be one of "Flat/ Apartment", "Villa", "Residential Land/ Plot")
- sublocality: (Area or road name, e.g. "Harlur Road" or "Devanahalli")
- city: "Bangalore"
- state: "Karnataka"
- address: (Street location details)
- rera_registration_number: (Actual or mock RERA number, format PRM/KA/RERA/1251/...)

Return ONLY the raw JSON object. If the project cannot be identified as a real project in Bangalore, return null. Do not include markdown code blocks.`;

          const responseText = await generateText(prompt, "Return ONLY raw JSON object. Do not wrap in markdown.");
          
          let cleanJson = responseText.trim();
          if (cleanJson.startsWith("```")) {
            cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
          }

          if (cleanJson && cleanJson !== "null") {
            const parsed = JSON.parse(cleanJson);
            if (parsed && parsed.name) {
              const newProject = {
                name: parsed.name,
                promoter_name: parsed.promoter_name || "Unknown Promoter",
                project_type: parsed.project_type || "Flat/ Apartment",
                sublocality: parsed.sublocality || "",
                city: parsed.city || "Bangalore",
                state: parsed.state || "Karnataka",
                address: parsed.address || "",
                rera_registration_number: parsed.rera_registration_number || `PRM/KA/RERA/1251/310/PR/TEMP-${Date.now()}`
              };

              console.log(`[GET /api/projects] Dynamic discovery success: "${newProject.name}". Persisting to DB...`);
              
              // Initialize admin client to bypass Row Level Security inserts
              const adminSupabase = createClient(dbUrl, serviceKey);
              await adminSupabase.from("rera_projects").upsert(newProject, { onConflict: "rera_registration_number" });

              // Append to local search results
              dbProjects.push({
                name: newProject.name,
                sublocality: newProject.sublocality,
                city: newProject.city,
                state: newProject.state,
                address: newProject.address,
                project_type: newProject.project_type
              });
            }
          }
        } catch (err) {
          console.error("[GET /api/projects] Dynamic discovery error:", err);
        }
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
      type: p.project_type || "Flat/ Apartment"
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
        type: "Flat/ Apartment"
      }));
    }

    return NextResponse.json(results);
  } catch (err) {
    return toErrorResponse(err);
  }
}
