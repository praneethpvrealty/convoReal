import { supabaseAdmin } from '../lib/automations/admin-client';

async function checkDetails() {
  const supabase = supabaseAdmin();
  console.log("Fetching property details for PROP-1082...");
  const { data: prop, error: propError } = await supabase
    .from("properties")
    .select("*")
    .ilike("property_code", "%1082%")
    .maybeSingle();

  if (propError) {
    console.error("Property fetch error:", propError);
    return;
  }
  if (!prop) {
    console.log("Property not found. Let's list properties containing 1082 in code or title...");
    const { data: props } = await supabase
      .from("properties")
      .select("id, property_code, title, type, location, sublocality, price");
    console.log("All properties:", props);
    return;
  }

  console.log("Property PROP-1082 Details:", {
    id: prop.id,
    property_code: prop.property_code,
    title: prop.title,
    type: prop.type,
    location: prop.location,
    sublocality: prop.sublocality,
    city: prop.city,
    project: prop.project,
    price: prop.price,
    bedrooms: prop.bedrooms,
    rental_income: prop.rental_income,
    roi: prop.roi
  });

  console.log("\nFetching contact Surya...");
  const { data: contacts, error: contactError } = await supabase
    .from("contacts")
    .select("*")
    .ilike("name", "%Surya%");

  if (contactError) {
    console.error("Contact fetch error:", contactError);
    return;
  }

  console.log(`Found ${contacts?.length || 0} contacts named Surya:`);
  for (const contact of contacts || []) {
    // Fetch contact notes
    const { data: notes } = await supabase
      .from("contact_notes")
      .select("note_text")
      .eq("contact_id", contact.id);

    console.log({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      requirements: contact.requirements,
      property_interests: contact.property_interests,
      areas_of_interest: contact.areas_of_interest,
      min_budget: contact.min_budget,
      max_budget: contact.max_budget,
      no_budget: contact.no_budget,
      pref_property_types: contact.pref_property_types,
      pref_property_categories: contact.pref_property_categories,
      pref_areas: contact.pref_areas,
      pref_excluded_areas: contact.pref_excluded_areas,
      pref_budget_min: contact.pref_budget_min,
      pref_budget_max: contact.pref_budget_max,
      pref_bhk_min: contact.pref_bhk_min,
      pref_bhk_max: contact.pref_bhk_max,
      pref_extracted_at: contact.pref_extracted_at,
      notes: notes?.map(n => n.note_text) || []
    });
  }
}

checkDetails();
