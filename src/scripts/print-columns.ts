import { supabaseAdmin } from '../lib/automations/admin-client';

async function printCols() {
  const supabase = supabaseAdmin();
  
  const { data: prop } = await supabase.from("properties").select("*").limit(1).maybeSingle();
  console.log("Properties columns:", prop ? Object.keys(prop) : "No property found");
  
  const { data: contact } = await supabase.from("contacts").select("*").limit(1).maybeSingle();
  console.log("Contacts columns:", contact ? Object.keys(contact) : "No contact found");
}

printCols();
