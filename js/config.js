// ============================================================================
// config.js — Supabase client + app-wide constants
// Loaded as an ES module. Fill in SUPABASE_URL / SUPABASE_ANON_KEY below
// with the values from your Supabase project settings (Project Settings ->
// API). The anon key is safe to expose client-side; RLS policies in
// sql/schema.sql are what actually enforce access control.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://vmndzdyiobftjqpkacgb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtbmR6ZHlpb2JmdGpxcGthY2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNjY5NzMsImV4cCI6MjA5OTc0Mjk3M30.UoBPhg_LuJJb0fLo4SJxveitm6BBWuVLwSFqdcQ_f88";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---- meal / status constants ----------------------------------------------
export const MEAL_TYPES = ["breakfast", "lunch", "dinner"];

export const MEAL_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export const BOOKING_OPTIONS = ["yes", "no", "double"];

// confirmation options — the base three plus No Food, which is only
// offered per-meal when the admin has enabled it (see getSettings() /
// no_food_enabled_<meal> below). booking (tomorrow) never offers No Food —
// it's a same-day confirmation-only option.
export const CONFIRM_BASE_OPTIONS = ["yes", "no", "double"];

export const STATUS_LABELS = {
  yes: "Yes",
  no: "No",
  double: "Double Food",
  no_food: "No Food",
};

export const EXPENSE_CATEGORIES = [
  "grocery",
  "meat",
  "fish",
  "gas",
  "staff_salary",
  "electricity",
  "water",
  "maintenance",
  "other",
];

export const EXPENSE_CATEGORY_LABELS = {
  grocery: "Grocery",
  meat: "Meat",
  fish: "Fish",
  gas: "Gas",
  staff_salary: "Staff Salary",
  electricity: "Electricity",
  water: "Water",
  maintenance: "Maintenance",
  other: "Other",
};

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

// default fallbacks — actual values are read from the `settings` table
// via utils.js:getSettings() and merged over these
export const DEFAULT_SETTINGS = {
  // single window for BOTH tomorrow's booking and today's confirmation —
  // see js/student/booking.js / confirmation.js. confirmation_deadline is
  // kept as a settings key for backward compatibility but is no longer
  // read anywhere in the app.
  booking_open_time: "20:30",
  booking_close_time: "23:30",
  confirmation_deadline: "11:59",
  fine_mismatch_amount: "250",
  fine_no_confirmation_amount: "100",
  no_food_enabled_breakfast: "false",
  no_food_enabled_lunch: "false",
  no_food_enabled_dinner: "false",
  meal_rate_breakfast: "0",
  meal_rate_lunch: "0",
  meal_rate_dinner: "0",
};
