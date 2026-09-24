import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJson } from "@/lib/ai/gemini";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  toAiDiscoveredProject,
  type AiDiscoveredProject,
  type ProjectSource,
} from "@/lib/projects/ai-discovery";

// Pre-compiled list of 155 popular residential projects in Bangalore Urban, Rural, and surrounding taluks
const CORE_PROJECTS = [
  { name: "SJR Blue Waters", promoter_name: "SJR Primecorp", project_type: "Flat/ Apartment", sublocality: "Harlur Road", address: "Harlur Road, Near Sarjapur Road", total_units: 300, total_land_area: 4 },
  { name: "Swiss Town", promoter_name: "Swiss Infrastructure", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Sadahalli Road, Devanahalli Outskirts, Bangalore", total_units: 250, total_land_area: 120 },
  { name: "Hollywood Town", promoter_name: "Swiss Infrastructure", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Sadahalli Road, Devanahalli Outskirts, Bangalore", total_units: 180, total_land_area: 60 },
  // APARTMENTS
  { name: "Prestige Shantiniketan", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Whitefield", address: "ITPL Main Road, Whitefield", total_units: 3000, total_land_area: 105 },
  { name: "Sobha Dream Acres", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Panathur", address: "Balagere Road, Panathur", total_units: 6500, total_land_area: 81 },
  { name: "Brigade Gateway", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Malleshwaram", address: "Dr. Rajkumar Road, Rajajinagar", total_units: 1200, total_land_area: 40 },
  { name: "Phoenix One Bangalore West", promoter_name: "Phoenix Mills", project_type: "Flat/ Apartment", sublocality: "Rajajinagar", address: "Dr. Rajkumar Road, Rajajinagar", total_units: 700, total_land_area: 17 },
  { name: "Purva Palm Beach", promoter_name: "Puravankara Limited", project_type: "Flat/ Apartment", sublocality: "Hennur", address: "Hennur Main Road", total_units: 1075, total_land_area: 19 },
  { name: "Salarpuria Sattva Greenage", promoter_name: "Salarpuria Sattva", project_type: "Flat/ Apartment", sublocality: "Bommanahalli", address: "Hosur Road, Bommanahalli", total_units: 1676, total_land_area: 21 },
  { name: "Bhartiya City Nikoo Homes", promoter_name: "Bhartiya City Developers", project_type: "Flat/ Apartment", sublocality: "Thanisandra", address: "Thanisandra Main Road", total_units: 2400, total_land_area: 126 },
  { name: "Prestige Falcon City", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Kanakapura Road", address: "Anjanadri Layout, Konanakunte", total_units: 2520, total_land_area: 41 },
  { name: "Assetz Marq", promoter_name: "Assetz Property Group", project_type: "Flat/ Apartment", sublocality: "Kannamangala", address: "Whitefield-Hoskote Road", total_units: 1800, total_land_area: 22 },
  { name: "Prestige Jindal City", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Tumkur Road", address: "Near Anchepalya, Tumkur Road", total_units: 3578, total_land_area: 32 },
  { name: "Godrej Ananda", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Bagalur", address: "Bagalur Aerospace Park", total_units: 2200, total_land_area: 20 },
  { name: "Brigade El Dorado", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Bagalur", address: "Aerospace Park, Bagalur", total_units: 4100, total_land_area: 50 },
  { name: "Sobha Royal Pavilion", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Hadosiddapura, Sarjapur Road", total_units: 1284, total_land_area: 24 },
  { name: "Godrej Eternity", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Kanakapura Road", address: "Mallasandra, Kanakapura Road", total_units: 800, total_land_area: 18 },
  { name: "Total Environment Learning to Fly", promoter_name: "Total Environment", project_type: "Flat/ Apartment", sublocality: "JP Nagar", address: "Phase 3, JP Nagar", total_units: 210, total_land_area: 4 },
  { name: "Birla Trimaya", promoter_name: "Birla Estates", project_type: "Flat/ Apartment", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 2500, total_land_area: 50 },
  { name: "Provident Park Square", promoter_name: "Provident Housing", project_type: "Flat/ Apartment", sublocality: "Kanakapura Road", address: "Judicial Layout, Kanakapura Road", total_units: 2002, total_land_area: 20 },
  { name: "Casagrand Esmeralda", promoter_name: "Casagrand Builder", project_type: "Villa", sublocality: "Sarjapur", address: "Sarjapur Main Road", total_units: 47, total_land_area: 3 },
  { name: "Prestige Finsbury Park", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Bagalur", address: "Gummanahalli, Bagalur Aerospace Park", total_units: 3058, total_land_area: 25 },
  { name: "Shriram Greenfield", promoter_name: "Shriram Properties", project_type: "Flat/ Apartment", sublocality: "Budigere Cross", address: "Budigere Cross, Old Madras Road Outskirts", total_units: 1645, total_land_area: 19 },
  { name: "Brigade Lakefront", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Whitefield", address: "EPIP Zone, Whitefield", total_units: 800, total_land_area: 20 },
  { name: "Prestige Lakeside Habitat", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Varthur", address: "Whitefield-Sarjapur Road, Varthur", total_units: 3426, total_land_area: 102 },
  { name: "Sobha Indraprastha", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Rajajinagar", address: "Minerva Mills Compound, Rajajinagar", total_units: 356, total_land_area: 9 },
  { name: "Purva Sunflower", promoter_name: "Puravankara Limited", project_type: "Flat/ Apartment", sublocality: "Rajajinagar", address: "Magadi Road, Rajajinagar", total_units: 326, total_land_area: 5 },
  { name: "Assetz 63 Degree East", promoter_name: "Assetz Property Group", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Off Sarjapur Road, Doddakannelli", total_units: 1600, total_land_area: 26 },
  { name: "Salarpuria Sattva Anugraha", promoter_name: "Salarpuria Sattva", project_type: "Flat/ Apartment", sublocality: "Vijayanagar", address: "Kamakshipalya, Vijayanagar", total_units: 1384, total_land_area: 12 },
  { name: "Godrej Aqua", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "International Airport Road", address: "Billahalli, International Airport Road", total_units: 390, total_land_area: 7 },
  { name: "Brigade Panorama", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Mysore Road", address: "Kambipura, Mysore Road Outskirts", total_units: 1035, total_land_area: 11 },
  { name: "Casagrand Zenith", promoter_name: "Casagrand Builder", project_type: "Flat/ Apartment", sublocality: "K R Puram", address: "Medahalli, K R Puram", total_units: 432, total_land_area: 5 },
  { name: "Prestige Song of the South", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Begur Road", address: "Begur Road, Bangalore South", total_units: 2178, total_land_area: 36 },
  { name: "Sobha Dream Gardens", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Thanisandra", address: "Bellahalli, Thanisandra Main Road", total_units: 2000, total_land_area: 18 },
  { name: "Brigade Buena Vista", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Budigere Cross", address: "Old Madras Road, Budigere", total_units: 752, total_land_area: 7 },
  { name: "Godrej Reflections", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Kasavanahalli, Sarjapur Road", total_units: 265, total_land_area: 6 },
  { name: "Provident Sunworth", promoter_name: "Provident Housing", project_type: "Flat/ Apartment", sublocality: "Mysore Road", address: "Venkatapura, Mysore Road Outskirts", total_units: 3200, total_land_area: 60 },
  { name: "Shriram Blue", promoter_name: "Shriram Properties", project_type: "Flat/ Apartment", sublocality: "K R Puram", address: "Medahalli-K R Puram", total_units: 471, total_land_area: 9 },
  { name: "Sobha Arena", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Kanakapura Road", address: "Talaghattapura, Kanakapura Road", total_units: 657, total_land_area: 10 },
  { name: "Prestige Misty Waters", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Hebbal", address: "Chola Nagar, Hebbal", total_units: 558, total_land_area: 6 },
  { name: "Rohan Upavan", promoter_name: "Rohan Builders", project_type: "Flat/ Apartment", sublocality: "Hennur Road", address: "Chikkagubbi, Hennur Road Outskirts", total_units: 1200, total_land_area: 14 },
  { name: "Assetz Soul & Soil", promoter_name: "Assetz Property Group", project_type: "Villa", sublocality: "Hennur Road", address: "Off Hennur Road Outskirts", total_units: 130, total_land_area: 7 },
  { name: "Salarpuria Sattva Park Cubix", promoter_name: "Salarpuria Sattva", project_type: "Flat/ Apartment", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 1620, total_land_area: 18 },
  { name: "Purva Whitehall", promoter_name: "Puravankara Limited", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Sarjapur Main Road, Harlur", total_units: 192, total_land_area: 3 },
  { name: "Brigade Exotica", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Old Madras Road", address: "Konasandra, Old Madras Road", total_units: 454, total_land_area: 10 },
  { name: "Prestige Tranquility", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Budigere", address: "Budigere Outskirts, Bangalore East", total_units: 2368, total_land_area: 38 },
  { name: "Shriram Signia", promoter_name: "Shriram Properties", project_type: "Flat/ Apartment", sublocality: "Electronic City", address: "Phase 1, Electronic City", total_units: 348, total_land_area: 5 },
  { name: "Godrej 24", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Carmelaram, Sarjapur Road", total_units: 439, total_land_area: 6 },
  { name: "Casagrand Orlena", promoter_name: "Casagrand Builder", project_type: "Flat/ Apartment", sublocality: "Hennur Road", address: "Hennur Junction, Bangalore North", total_units: 216, total_land_area: 4 },
  { name: "Prestige Kew Gardens", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Yemalur", address: "Yemalur, Near Marathahalli", total_units: 970, total_land_area: 15 },
  { name: "Sobha Sentosa", promoter_name: "Sobha Developers", project_type: "Flat/ Apartment", sublocality: "Panathur", address: "Panathur Main Road, Bangalore East", total_units: 533, total_land_area: 7 },
  { name: "Brigade Woods", promoter_name: "Brigade Group", project_type: "Flat/ Apartment", sublocality: "Whitefield", address: "ITPL Hope Farm, Whitefield", total_units: 333, total_land_area: 6 },
  { name: "Purva Zenium", promoter_name: "Puravankara Limited", project_type: "Flat/ Apartment", sublocality: "Hosahalli", address: "International Airport Road Outskirts", total_units: 750, total_land_area: 10 },

  // VILLAS & ROW HOUSES
  { name: "Adarsh Palm Retreat", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Bellandur", address: "Outer Ring Road, Bellandur", total_units: 800, total_land_area: 110 },
  { name: "Prestige Augusta Golf Village", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Horamavu", address: "Anagalapura, Near Horamavu", total_units: 460, total_land_area: 104 },
  { name: "Prestige Lakeside Habitat Villas", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Varthur", address: "Whitefield-Sarjapur Road", total_units: 271, total_land_area: 102 },
  { name: "Total Environment Windmills of Your Mind", promoter_name: "Total Environment", project_type: "Villa", sublocality: "Whitefield", address: "EPIP Zone, Whitefield", total_units: 300, total_land_area: 24 },
  { name: "Total Environment Pursuit of Radical Rhapsody Villas", promoter_name: "Total Environment", project_type: "Villa", sublocality: "Whitefield", address: "ITPL Main Road, Whitefield", total_units: 150, total_land_area: 34 },
  { name: "Divyasree 77 East", promoter_name: "DivyaSree Developers", project_type: "Villa", sublocality: "Marathahalli", address: "Yemalur Main Road, Marathahalli", total_units: 380, total_land_area: 77 },
  { name: "Raffles Residency Villas", promoter_name: "Raffles Infrastructure", project_type: "Villa", sublocality: "Sarjapur Road", address: "Sarjapur Main Road", total_units: 180, total_land_area: 15 },
  { name: "Hiranandani Cottages", promoter_name: "House of Hiranandani", project_type: "Villa", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 220, total_land_area: 30 },
  { name: "Adarsh Wisteria", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Hennur Road", address: "Chikkagubbi, Hennur Outskirts", total_units: 198, total_land_area: 16 },
  { name: "Palm Meadows", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Whitefield", address: "Ramagondanahalli, Varthur Road", total_units: 570, total_land_area: 100 },
  { name: "Concorde Napa Valley", promoter_name: "Concorde Group", project_type: "Villa", sublocality: "Kanakapura Road", address: "Kaggalipura, Kanakapura Road", total_units: 450, total_land_area: 110 },
  { name: "Adarsh Palm Acres", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Devanahalli", address: "Bagalur-Devanahalli Road Outskirts", total_units: 250, total_land_area: 980 },
  { name: "Prestige Golfshire", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Nandi Hills", address: "Nandi Hills Road Outskirts", total_units: 228, total_land_area: 275 },
  { name: "Sobha Malabar Hill", promoter_name: "Sobha Developers", project_type: "Villa", sublocality: "Yelahanka", address: "Yelahanka Main Road", total_units: 95, total_land_area: 20 },
  { name: "Nambiar Bellezea", promoter_name: "Nambiar Builders", project_type: "Villa", sublocality: "Sarjapur Road", address: "Kachanayakanahalli, Sarjapur Road", total_units: 350, total_land_area: 100 },
  { name: "Raffles Park", promoter_name: "Raffles Infrastructure", project_type: "Villa", sublocality: "Hope Farm, Whitefield", address: "Hope Farm Cross, Whitefield", total_units: 61, total_land_area: 15 },
  { name: "Assetz Leaves & Lives", promoter_name: "Assetz Property Group", project_type: "Villa", sublocality: "Sarjapur Road", address: "Off Sarjapur Road, Bangalore East", total_units: 79, total_land_area: 6 },
  { name: "Shriram Chirping Woods Villas", promoter_name: "Shriram Properties", project_type: "Villa", sublocality: "Sarjapur Road", address: "Harlur Road, Near Sarjapur", total_units: 110, total_land_area: 16 },
  { name: "Purva Sound of Water", promoter_name: "Puravankara Limited", project_type: "Villa", sublocality: "Bannerghatta Road", address: "Koppa Gate, Bannerghatta Road", total_units: 207, total_land_area: 20 },
  { name: "Godrej Reserve", promoter_name: "Godrej Properties", project_type: "Villa", sublocality: "Devanahalli", address: "Kannamangala, Devanahalli Outskirts", total_units: 420, total_land_area: 92 },
  { name: "Prestige Whispering Pines", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Whitefield", address: "Ramagondanahalli, Whitefield", total_units: 120, total_land_area: 15 },
  { name: "Brigade Orchards Villas", promoter_name: "Brigade Group", project_type: "Villa", sublocality: "Devanahalli", address: "NH-7, Devanahalli Outskirts", total_units: 180, total_land_area: 130 },
  { name: "Sobha Lifestyle Legacy", promoter_name: "Sobha Developers", project_type: "Villa", sublocality: "Devanahalli", address: "Shettigere, Devanahalli", total_units: 165, total_land_area: 55 },
  { name: "Adarsh Tranqville", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Hennur Road", address: "Chikkagubbi, Hennur Road", total_units: 104, total_land_area: 14 },
  { name: "Total Environment After the Rain", promoter_name: "Total Environment", project_type: "Villa", sublocality: "Yelahanka", address: "Sir MVIT College Road, Yelahanka", total_units: 245, total_land_area: 45 },
  { name: "Embassy Boulevard", promoter_name: "Embassy Group", project_type: "Villa", sublocality: "Yelahanka", address: "Hunasamaranahalli, Yelahanka", total_units: 170, total_land_area: 51 },
  { name: "Prestige Woodside", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Yelahanka", address: "Agrahara, Yelahanka Outskirts", total_units: 132, total_land_area: 14 },
  { name: "Divyasree 77 Place", promoter_name: "DivyaSree Developers", project_type: "Villa", sublocality: "Marathahalli", address: "Yemalur Road, Marathahalli", total_units: 60, total_land_area: 10 },
  { name: "Salarpuria Sattva Northland", promoter_name: "Salarpuria Sattva", project_type: "Villa", sublocality: "Hennur Road", address: "Hennur Main Road, Bangalore North", total_units: 34, total_land_area: 3 },
  { name: "Casagrand Woodside", promoter_name: "Casagrand Builder", project_type: "Villa", sublocality: "K R Puram", address: "Medahalli, K R Puram", total_units: 54, total_land_area: 4 },
  { name: "Incor Carmel Heights", promoter_name: "Incor Infrastructure", project_type: "Villa", sublocality: "Whitefield", address: "Varthur Road, Whitefield", total_units: 45, total_land_area: 5 },
  { name: "Alliance Humming Gardens", promoter_name: "Alliance Group", project_type: "Villa", sublocality: "Whitefield Outskirts", address: "Whitefield Ext, Bangalore East", total_units: 120, total_land_area: 12 },
  { name: "Sobha Emerald", promoter_name: "Sobha Developers", project_type: "Villa", sublocality: "Jakkur", address: "Jakkur Road, Bangalore North", total_units: 70, total_land_area: 8 },
  { name: "Godrej Woodscapes", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Budigere Cross", address: "Budigere, Old Madras Road", total_units: 2000, total_land_area: 28 },
  { name: "Prestige Lavender Fields", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Varthur", address: "Varthur Main Road, Bangalore East", total_units: 1473, total_land_area: 18 },
  { name: "Shriram Earth Villas", promoter_name: "Shriram Properties", project_type: "Villa", sublocality: "Kanakapura", address: "Harohalli, Kanakapura Outskirts", total_units: 80, total_land_area: 10 },
  { name: "Adarsh Sanctuary", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Sarjapur Road", address: "Off Sarjapur Road, Bangalore East", total_units: 156, total_land_area: 21 },
  { name: "Casagrand Florella", promoter_name: "Casagrand Builder", project_type: "Villa", sublocality: "Sarjapur", address: "Sarjapur Main Road", total_units: 36, total_land_area: 2 },
  { name: "Brigade Atmosphere", promoter_name: "Brigade Group", project_type: "Villa", sublocality: "Devanahalli", address: "NH-7, Devanahalli", total_units: 109, total_land_area: 18 },
  { name: "Prestige Summer Fields", promoter_name: "Prestige Group", project_type: "Villa", sublocality: "Marathahalli", address: "Yemalur Main Road, Bangalore East", total_units: 83, total_land_area: 12 },

  // PLOTS & LAYOUTS
  { name: "Prestige Great Acres", promoter_name: "Prestige Group", project_type: "Residential Land/ Plot", sublocality: "Sarjapur Road", address: "Yamare, Sarjapur Road", total_units: 808, total_land_area: 80 },
  { name: "Brigade Oasis", promoter_name: "Brigade Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts, Near Airport", total_units: 450, total_land_area: 40 },
  { name: "Century Eden", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Doddaballapur Road", address: "Marasandra, Doddaballapur Road Outskirts", total_units: 512, total_land_area: 36 },
  { name: "Purva Tivoli Hills", promoter_name: "Puravankara Limited", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Southegowdanahalli, Devanahalli Outskirts", total_units: 839, total_land_area: 60 },
  { name: "Godrej Woodland", promoter_name: "Godrej Properties", project_type: "Residential Land/ Plot", sublocality: "Sarjapur Road", address: "Hoskote-Sarjapur Road Outskirts", total_units: 1240, total_land_area: 100 },
  { name: "Sobha Canvas", promoter_name: "Sobha Developers", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli", total_units: 77, total_land_area: 10 },
  { name: "Concorde Spring Meadows Plots", promoter_name: "Concorde Group", project_type: "Residential Land/ Plot", sublocality: "Hesaraghatta Road", address: "Hesaraghatta Outskirts", total_units: 150, total_land_area: 12 },
  { name: "Shriram Earth", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Kanakapura", address: "Kanakapura Outskirts, Harohalli", total_units: 380, total_land_area: 20 },
  { name: "Valmark Orchard Square Plots", promoter_name: "Valmark Group", project_type: "Residential Land/ Plot", sublocality: "Begur Road", address: "Begur, Bangalore South", total_units: 240, total_land_area: 15 },
  { name: "Embassy Springs", promoter_name: "Embassy Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts, Near Airport", total_units: 1150, total_land_area: 288 },
  { name: "Tata Swaram", promoter_name: "Tata Housing", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 350, total_land_area: 23 },
  { name: "Shravanthi Oakridge", promoter_name: "Shravanthi Shelters", project_type: "Residential Land/ Plot", sublocality: "Kanakapura Road", address: "Anjanapura, Bangalore South", total_units: 120, total_land_area: 8 },
  { name: "Vakil Whispering Woods", promoter_name: "Vakil Housing Development", project_type: "Residential Land/ Plot", sublocality: "Jigani", address: "Jigani Outskirts, Anekal Taluk", total_units: 640, total_land_area: 52 },
  { name: "Vakil Metropolis", promoter_name: "Vakil Housing Development", project_type: "Residential Land/ Plot", sublocality: "Jigani", address: "Jigani, Anekal Road Outskirts", total_units: 320, total_land_area: 24 },
  { name: "DLF Woodland Heights", promoter_name: "DLF", project_type: "Residential Land/ Plot", sublocality: "Jigani", address: "Jigani Main Road Outskirts", total_units: 410, total_land_area: 30 },
  { name: "Century Artizan", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Yelahanka", address: "Chikkabubbi, Yelahanka Outskirts", total_units: 280, total_land_area: 48 },
  { name: "Salarpuria Sattva Pipal Tree", promoter_name: "Salarpuria Sattva", project_type: "Residential Land/ Plot", sublocality: "Tavarekere", address: "Tavarekere Outskirts, Bangalore West", total_units: 550, total_land_area: 37 },
  { name: "Purva Land Sound of Water", promoter_name: "Puravankara Limited", project_type: "Residential Land/ Plot", sublocality: "Bannerghatta", address: "Koppa Gate, Bannerghatta Outskirts", total_units: 180, total_land_area: 15 },
  { name: "Brigade Oak Tree Place", promoter_name: "Brigade Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "NH-7, Devanahalli Outskirts", total_units: 210, total_land_area: 22 },
  { name: "Prestige Marigold", promoter_name: "Prestige Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Bettenahalli, Devanahalli Outskirts", total_units: 396, total_land_area: 50 },
  { name: "Century Seasons", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Doddaballapur Road", address: "Doddaballapur Outskirts", total_units: 412, total_land_area: 30 },
  { name: "Shriram Earth Whitefield", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Budigere", address: "Budigere Cross Outskirts", total_units: 280, total_land_area: 18 },
  { name: "Concorde Auriga Plots", promoter_name: "Concorde Group", project_type: "Residential Land/ Plot", sublocality: "Old Madras Road", address: "Konasandra, Old Madras Road Outskirts", total_units: 160, total_land_area: 12 },
  { name: "Purva Land Palm Hills", promoter_name: "Puravankara Limited", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 320, total_land_area: 25 },
  { name: "Century Greens", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Doddaballapur Road", address: "Doddaballapur Road Outskirts", total_units: 340, total_land_area: 22 },
  { name: "Brigade Meadows Plots", promoter_name: "Brigade Group", project_type: "Residential Land/ Plot", sublocality: "Kanakapura Road", address: "Kaggalipura, Kanakapura Road", total_units: 150, total_land_area: 12 },
  { name: "Adarsh Savana", promoter_name: "Adarsh Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 950, total_land_area: 99 },
  { name: "Tata New Haven Plots", promoter_name: "Tata Housing", project_type: "Residential Land/ Plot", sublocality: "Nelamangala", address: "Mallasandra, Nelamangala Outskirts", total_units: 250, total_land_area: 18 },
  { name: "Shriram Sameeksha Plots", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Nelamangala", address: "Nelamangala Outskirts", total_units: 120, total_land_area: 9 },
  { name: "BMR Farms", promoter_name: "BMR Developers", project_type: "Residential Land/ Plot", sublocality: "Nelamangala", address: "Nelamangala Outskirts", total_units: 90, total_land_area: 35 },
  { name: "DLF Regal Gardens Plots", promoter_name: "DLF", project_type: "Residential Land/ Plot", sublocality: "Nelamangala", address: "Nelamangala Main Road Outskirts", total_units: 180, total_land_area: 15 },
  { name: "Century Mark", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 140, total_land_area: 10 },
  { name: "Prestige Park Ridge", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Bannerghatta Road", address: "Bannerghatta Main Road", total_units: 1100, total_land_area: 15 },
  { name: "Salarpuria Sattva Serene Life", promoter_name: "Salarpuria Sattva", project_type: "Residential Land/ Plot", sublocality: "Shettigere", address: "Shettigere, Devanahalli Outskirts", total_units: 320, total_land_area: 25 },
  { name: "Purva Land Atmosphere", promoter_name: "Puravankara Limited", project_type: "Residential Land/ Plot", sublocality: "Thanisandra", address: "Thanisandra Main Road Outskirts", total_units: 240, total_land_area: 16 },
  { name: "Godrej Hillside", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Kanakapura Road", address: "Mallasandra, Kanakapura Road", total_units: 950, total_land_area: 15 },
  { name: "Casagrand Meredian", promoter_name: "Casagrand Builder", project_type: "Flat/ Apartment", sublocality: "K R Puram", address: "K R Puram Main Road", total_units: 310, total_land_area: 4 },
  { name: "Sobha Dream Acres Plots", promoter_name: "Sobha Developers", project_type: "Residential Land/ Plot", sublocality: "Panathur outskirts", address: "Balagere Road Outskirts", total_units: 120, total_land_area: 12 },
  { name: "Vakil Whispering Woods Phase 2", promoter_name: "Vakil Housing Development", project_type: "Residential Land/ Plot", sublocality: "Jigani", address: "Jigani, Anekal Taluk", total_units: 240, total_land_area: 18 },
  { name: "Abhee Silicon Shine", promoter_name: "Abhee Developers", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Sarjapur Main Road", total_units: 350, total_land_area: 4 },
  { name: "Shriram Greenfield Plots", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Budigere", address: "Budigere Cross Outskirts", total_units: 180, total_land_area: 10 },
  { name: "Century Breeze", promoter_name: "Century Real Estate", project_type: "Flat/ Apartment", sublocality: "Jakkur", address: "Jakkur Road, Bangalore North", total_units: 320, total_land_area: 6 },
  { name: "Brigade Oasis Phase 2", promoter_name: "Brigade Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 220, total_land_area: 18 },
  { name: "Prestige Marigold Phase 2", promoter_name: "Prestige Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Bettenahalli, Devanahalli", total_units: 180, total_land_area: 22 },
  { name: "Godrej Woodland Phase 2", promoter_name: "Godrej Properties", project_type: "Residential Land/ Plot", sublocality: "Sarjapur", address: "Hoskote-Sarjapur Road", total_units: 450, total_land_area: 35 },
  { name: "Purva Land Tivoli Hills Phase 2", promoter_name: "Puravankara Limited", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 310, total_land_area: 20 },
  { name: "Shriram Earth Harohalli", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Kanakapura Outskirts", address: "Harohalli, Kanakapura", total_units: 150, total_land_area: 12 },
  { name: "Century Eden Phase 2", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Doddaballapur Road", address: "Marasandra, Doddaballapur Road", total_units: 210, total_land_area: 15 },
  { name: "Vakil Whispering Woods Phase 3", promoter_name: "Vakil Housing Development", project_type: "Residential Land/ Plot", sublocality: "Jigani", address: "Jigani Outskirts", total_units: 180, total_land_area: 15 },
  { name: "Sobha Lifestyle Legacy Phase 2", promoter_name: "Sobha Developers", project_type: "Villa", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 80, total_land_area: 25 },
  { name: "Adarsh Savana Phase 2", promoter_name: "Adarsh Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli", total_units: 420, total_land_area: 40 },
  { name: "Embassy Springs Phase 2", promoter_name: "Embassy Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 500, total_land_area: 120 },
  { name: "Tata Swaram Phase 2", promoter_name: "Tata Housing", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 150, total_land_area: 10 },
  { name: "Century Seasons Phase 2", promoter_name: "Century Real Estate", project_type: "Residential Land/ Plot", sublocality: "Doddaballapur Road", address: "Doddaballapur Road Outskirts", total_units: 180, total_land_area: 12 },
  { name: "Brigade Oak Tree Place Phase 2", promoter_name: "Brigade Group", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Devanahalli Outskirts", total_units: 90, total_land_area: 10 },
  { name: "Salarpuria Sattva Serene Life Phase 2", promoter_name: "Salarpuria Sattva", project_type: "Residential Land/ Plot", sublocality: "Shettigere", address: "Shettigere Outskirts", total_units: 150, total_land_area: 12 },
  { name: "Godrej Hillside Phase 2", promoter_name: "Godrej Properties", project_type: "Flat/ Apartment", sublocality: "Kanakapura", address: "Kanakapura Road Outskirts", total_units: 450, total_land_area: 8 },
  { name: "Shriram Earth Whitefield Phase 2", promoter_name: "Shriram Properties", project_type: "Residential Land/ Plot", sublocality: "Budigere", address: "Budigere Cross Outskirts", total_units: 120, total_land_area: 8 },
  { name: "Sobha Canvas Phase 2", promoter_name: "Sobha Developers", project_type: "Residential Land/ Plot", sublocality: "Devanahalli", address: "Shettigere, Devanahalli Outskirts", total_units: 50, total_land_area: 6 },
  { name: "Prestige Great Acres Phase 2", promoter_name: "Prestige Group", project_type: "Residential Land/ Plot", sublocality: "Sarjapur", address: "Yamare, Sarjapur", total_units: 320, total_land_area: 30 },
  { name: "Concorde Napa Valley Phase 2", promoter_name: "Concorde Group", project_type: "Villa", sublocality: "Kanakapura", address: "Kaggalipura, Kanakapura Road", total_units: 180, total_land_area: 40 },
  { name: "Adarsh Wisteria Phase 2", promoter_name: "Adarsh Group", project_type: "Villa", sublocality: "Hennur", address: "Chikkagubbi, Hennur Road Outskirts", total_units: 80, total_land_area: 8 },
  { name: "Salarpuria Sattva Park Cubix Phase 2", promoter_name: "Salarpuria Sattva", project_type: "Flat/ Apartment", sublocality: "Devanahalli", address: "Shettigere, Devanahalli", total_units: 600, total_land_area: 8 },
  { name: "Nambiar District 25", promoter_name: "Nambiar Builders", project_type: "Flat/ Apartment", sublocality: "Sarjapur Road", address: "Sarjapur-Attibele Road", total_units: 3500, total_land_area: 100 },
  { name: "Prestige Raintree Park", promoter_name: "Prestige Group", project_type: "Flat/ Apartment", sublocality: "Whitefield", address: "Whitefield Main Road", total_units: 1520, total_land_area: 28 },
  { name: "Birla Ojasvi", promoter_name: "Birla Estates", project_type: "Flat/ Apartment", sublocality: "Rajarajeshwari Nagar", address: "RR Nagar, Bangalore South", total_units: 630, total_land_area: 10 }
];

const SEEDED_PROJECTS = CORE_PROJECTS.map((proj) => ({
  ...proj,
  city: "Bangalore",
  state: "Karnataka",
  source: "curated" as ProjectSource,
}));

const EXPANSION_SYSTEM =
  "You list real estate projects in and around Bangalore. Reply with a JSON array. Include only projects you are confident exist; leave a field empty rather than guessing it.";

const EXPANSION_PROMPT = `List 15 additional popular or recently launched residential projects (apartments, villas, or layouts/plots) in Bangalore outskirts and surrounding areas (including Devanahalli, Hoskote, Sarjapur, Kanakapura, Jigani, Bagalur, Nelamangala, Doddaballapur, Harohalli, Anekal, Attibele, Bidadi).

For each project, output a JSON object with:
- name: project name
- promoter_name: builder name, or "" if unsure
- project_type: one of "Flat/ Apartment", "Villa", "Residential Land/ Plot"
- sublocality: area name
- city: "Bangalore"
- state: "Karnataka"
- address: road or layout details, or "" if unsure
- total_units: integer estimate, or null
- total_land_area: size in acres, or null`;

async function insertMissing<T extends { name: string }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<number> {
  const { data: existing, error: readError } = await admin
    .from("rera_projects")
    .select("name");
  if (readError) throw readError;
  const known = new Set((existing ?? []).map((r: { name: string }) => r.name.trim().toLowerCase()));
  const fresh: T[] = [];
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(row);
  }
  if (fresh.length === 0) return 0;
  const { error } = await admin.from("rera_projects").insert(fresh);
  if (error) throw error;
  return fresh.length;
}

export async function POST() {
  try {
    await requireRole("viewer");

    const admin = supabaseAdmin();
    const seededCount = await insertMissing(admin, SEEDED_PROJECTS);

    let scrapedCount = 0;
    let geminiError: string | null = null;
    try {
      const parsed: unknown = JSON.parse(
        await generateJson(EXPANSION_PROMPT, EXPANSION_SYSTEM, { feature: "project_sync" }),
      );
      const generated = (Array.isArray(parsed) ? parsed : [])
        .map(toAiDiscoveredProject)
        .filter((p): p is AiDiscoveredProject => p !== null);
      scrapedCount = await insertMissing(admin, generated);
    } catch (err) {
      console.error("[Sync Projects] Gemini expansion failed:", err);
      geminiError = err instanceof Error ? err.message : String(err);
    }

    return NextResponse.json({
      success: true,
      seeded_count: seededCount,
      scraped_count: scrapedCount,
      total_upserted: seededCount + scrapedCount,
      gemini_expansion: geminiError ? `Failed: ${geminiError}` : "Success",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
