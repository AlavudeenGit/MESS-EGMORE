// ============================================================================
// supabase/functions/lock-confirmations/index.ts
// Scheduled once daily, shortly after `settings.booking_close_time` — the
// SAME shared window as lock-bookings now uses (confirmation and tomorrow's
// booking share one evening window, e.g. 8:30–11:30 PM; see
// enforce_booking_write() in sql/schema.sql and js/student/confirmation.js).
// For every active student x meal_type, for today's date:
//   - lock any existing row (confirmation_locked = true)
//   - if a student booked yes/double but the row has no confirmed_status,
//     leave confirmed_status null but lock it — recompute_daily_fine()
//     reads exactly that combination to apply the ₹100 fine.
// Then calls recompute_daily_fine(student_id, today) for every active
// student so fines are finalized for the day.
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

    const { data: existingRows, error: existingError } = await supabase
      .from("bookings")
      .select("id, student_id, meal_type, booking_status")
      .eq("date", today);
    if (existingError) throw existingError;

    const existingKey = new Set(
      (existingRows || []).map((r) => `${r.student_id}:${r.meal_type}`),
    );
    const existingIds = (existingRows || []).map((r) => r.id);

    if (existingIds.length) {
      const { error } = await supabase
        .from("bookings")
        .update({ confirmation_locked: true })
        .in("id", existingIds)
        .eq("confirmation_locked", false);
      if (error) throw error;
    }

    // students with no row at all today (didn't even book) — create a
    // locked placeholder so the day is fully accounted for. No booking
    // means no fine either way, recompute_daily_fine() handles that.
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

    // finalize fines for every active student for today
    let fined = 0;
    for (const s of students || []) {
      const { error } = await supabase.rpc("recompute_daily_fine", {
        p_student_id: s.id,
        p_date: today,
      });
      if (error) {
        console.error("recompute_daily_fine failed for", s.id, error);
        continue;
      }
      fined++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        date: today,
        locked: existingIds.length,
        defaulted: missing.length,
        recomputed: fined,
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
