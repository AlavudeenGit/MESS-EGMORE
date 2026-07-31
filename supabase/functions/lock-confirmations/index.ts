// ============================================================================
// supabase/functions/lock-confirmations/index.ts
// Scheduled once daily, shortly after `settings.booking_close_time` — the
// SAME shared window as lock-bookings now uses (confirmation and tomorrow's
// booking share one evening window, e.g. 8:30–11:30 PM; see
// enforce_booking_write() in sql/schema.sql and js/student/confirmation.js).
//
// A meal is only student-editable in Today's Confirmation when No Food is
// enabled for it (Admin -> Settings). When it's disabled — the default —
// the meal is pre-filled from yesterday's booking and the student can't
// touch it at all, so THIS function is what actually finalizes it: for any
// meal where No Food is off and confirmed_status is still null, it copies
// booking_status into confirmed_status before locking — this keeps
// confirmed_status meaningful for reporting (Students Report, Monthly
// Attendance Report) even though nothing was ever fine-relevant about it.
//
// For every active student x meal_type, for today's date:
//   - auto-copy booking_status -> confirmed_status where No Food is disabled
//     and nothing has been confirmed yet
//   - lock any existing row (confirmation_locked = true)
//   - create a locked placeholder for any student with no row at all today
//
// Fines are no longer calculated anywhere in this app — this function used
// to also call recompute_daily_fine() for every active student; that call
// has been removed.
//
// Not exposed to the browser — invoke via pg_cron (see supabase/CRON.md).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MEAL_TYPES = ["breakfast", "lunch", "dinner"];

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret");
    if (Deno.env.get("CRON_SECRET") && secret !== Deno.env.get("CRON_SECRET")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const today = isoToday();

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id")
      .eq("status", "active");
    if (studentsError) throw studentsError;

    const { data: settingsRows, error: settingsError } = await supabase
      .from("settings")
      .select("key, value")
      .in(
        "key",
        MEAL_TYPES.map((m) => `no_food_enabled_${m}`),
      );
    if (settingsError) throw settingsError;
    const noFoodEnabled = {};
    MEAL_TYPES.forEach((m) => {
      noFoodEnabled[m] = false;
    });
    (settingsRows || []).forEach((r) => {
      noFoodEnabled[r.key.replace("no_food_enabled_", "")] = r.value === "true";
    });

    const { data: existingRows, error: existingError } = await supabase
      .from("bookings")
      .select("id, student_id, meal_type, booking_status, confirmed_status")
      .eq("date", today);
    if (existingError) throw existingError;

    const existingKey = new Set(
      (existingRows || []).map((r) => `${r.student_id}:${r.meal_type}`),
    );
    const existingIds = (existingRows || []).map((r) => r.id);

    // auto-copy booking_status -> confirmed_status for meals the student
    // was never allowed to touch (No Food disabled), so they're treated as
    // confirmed exactly as booked rather than "never confirmed"
    let autoConfirmed = 0;
    for (const row of existingRows || []) {
      if (
        row.confirmed_status === null &&
        !noFoodEnabled[row.meal_type] &&
        row.booking_status !== null
      ) {
        const { error } = await supabase
          .from("bookings")
          .update({
            confirmed_status: row.booking_status,
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) {
          console.error("auto-confirm failed for booking", row.id, error);
          continue;
        }
        autoConfirmed++;
      }
    }

    if (existingIds.length) {
      const { error } = await supabase
        .from("bookings")
        .update({ confirmation_locked: true })
        .in("id", existingIds)
        .eq("confirmation_locked", false);
      if (error) throw error;
    }

    // students with no row at all today (didn't even book) — create a
    // locked placeholder so the day is fully accounted for
    const missing = [];
    for (const s of students || []) {
      for (const meal of MEAL_TYPES) {
        if (!existingKey.has(`${s.id}:${meal}`)) {
          missing.push({
            student_id: s.id,
            date: today,
            meal_type: meal,
            confirmation_locked: true,
          });
        }
      }
    }
    if (missing.length) {
      const { error } = await supabase
        .from("bookings")
        .upsert(missing, {
          onConflict: "student_id,date,meal_type",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        date: today,
        autoConfirmed,
        locked: existingIds.length,
        defaulted: missing.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
    });
  }
});

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
