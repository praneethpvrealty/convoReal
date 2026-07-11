import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log("Checking contacts table...");
  const { error } = await supabase.from('contacts').select('id, phone').limit(1);
  if (error) {
    console.error("Error fetching contacts:", error);
    return;
  }
  
  // Try fetching secondary_phones
  const { data: data2, error: error2 } = await supabase.from('contacts').select('id, secondary_phones').limit(1);
  if (error2) {
    console.log("secondary_phones column is NOT present yet in the remote database. Error details:", error2.message);
  } else {
    console.log("secondary_phones column IS present in the remote database!", data2);
  }
}

main();
