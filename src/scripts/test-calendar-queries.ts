import { supabaseAdmin } from '../lib/automations/admin-client';

async function testQueries() {
  const supabase = supabaseAdmin();
  console.log("Testing appointments query...");
  try {
    const { data: appts, error: apptError } = await supabase
      .from("appointments")
      .select("*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)")
      .limit(1);
    if (apptError) {
      console.error("Appointments query failed:", apptError);
    } else {
      console.log("Appointments query succeeded! Found:", appts?.length || 0);
    }
  } catch (err) {
    console.error("Appointments query threw:", err);
  }

  console.log("Testing todos query...");
  try {
    const { data: todos, error: todoError } = await supabase
      .from("todos")
      .select("*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)")
      .limit(1);
    if (todoError) {
      console.error("Todos query failed:", todoError);
    } else {
      console.log("Todos query succeeded! Found:", todos?.length || 0);
    }
  } catch (err) {
    console.error("Todos query threw:", err);
  }
}

testQueries();
