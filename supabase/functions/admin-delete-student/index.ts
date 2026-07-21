// ============================================================================
// supabase/functions/admin-delete-student/index.ts
// PERMANENTLY deletes a student — distinct from deactivating (students.js's
// "Deactivate" button, which just flips status to 'inactive' and keeps the
// record). This actually removes the row from the database.
//
// Deleting the auth.users row (which requires the service role key — hence
// this has to be an Edge Function, not a browser call) cascades automatically:
//   auth.users --(ON DELETE CASCADE)--> students
//                                          --(ON DELETE CASCADE)--> bookings
//                                          --(ON DELETE CASCADE)--> fines
//                                          --(ON DELETE CASCADE)--> payments
// per the foreign keys in sql/schema.sql, so one call here fully removes the
// student and everything tied to them — not just the students row.
//
// Called with: supabase.functions.invoke('admin-delete-student', {
//   body: { student_id }
// })
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Missing Authorization header" }, 401);
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user)
      return json({ ok: false, error: "Invalid session" }, 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: adminRow } = await adminClient
      .from("admins")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!adminRow)
      return json({ ok: false, error: "Caller is not an admin" }, 403);

    const { student_id } = await req.json();
    if (!student_id)
      return json({ ok: false, error: "Missing student_id" }, 400);

    // confirm the target is actually a student before touching auth.users,
    // so this can't be pointed at an admin or an arbitrary uuid
    const { data: target } = await adminClient
      .from("students")
      .select("id, name")
      .eq("id", student_id)
      .maybeSingle();
    if (!target) return json({ ok: false, error: "Student not found" }, 404);

    // deleting the auth user cascades to students/bookings/fines/payments
    const { error: deleteError } =
      await adminClient.auth.admin.deleteUser(student_id);
    if (deleteError)
      return json({ ok: false, error: deleteError.message }, 400);

    return json({ ok: true, deleted_name: target.name });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
