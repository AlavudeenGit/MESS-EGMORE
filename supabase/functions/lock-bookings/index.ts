// ============================================================================
// supabase/functions/lock-bookings/index.ts
// Scheduled once daily, shortly after `settings.booking_close_time`.
// For every active student x meal_type, for tomorrow's date:
//   - if a booking row exists, lock it (booking_locked = true)
//   - if no row exists at all (student never opened the app), create one
//     with booking_status = 'no', locked — so meal counts and the meal
//     override screen have a complete picture, and so a student can't
//     sneak in a late "yes" after the window by upserting.
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

    // Optional shared-secret check so this can't be triggered by anyone
    // who guesses the URL. Set CRON_SECRET as a function secret and pass
    // it as `?secret=...` from the pg_cron http call.
    const url = new URL(req.url);
    const secret = url.searchParams.get("secret");
    if (Deno.env.get("CRON_SECRET") && secret !== Deno.env.get("CRON_SECRET")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const tomorrow = isoTomorrow();

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id")
      .eq("status", "active");
    if (studentsError) throw studentsError;

    const { data: existingRows, error: existingError } = await supabase
      .from("bookings")
      .select("id, student_id, meal_type")
      .eq("date", tomorrow);
    if (existingError) throw existingError;

    const existingKey = new Set(
      (existingRows || []).map((r) => `${r.student_id}:${r.meal_type}`),
    );
    const existingIds = (existingRows || []).map((r) => r.id);

    // lock every existing row for tomorrow
    if (existingIds.length) {
      const { error } = await supabase
        .from("bookings")
        .update({ booking_locked: true })
        .in("id", existingIds)
        .eq("booking_locked", false);
      if (error) throw error;
    }

    // create locked "no" rows for any student x meal combo with no row yet
    const missing = [];
    for (const s of students || []) {
      for (const meal of MEAL_TYPES) {
        if (!existingKey.has(`${s.id}:${meal}`)) {
          missing.push({
            student_id: s.id,
            date: tomorrow,
            meal_type: meal,
            booking_status: "no",
            booking_locked: true,
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
        date: tomorrow,
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

function isoTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
