// ============================================================================
// supabase/functions/student-register/index.ts
// Handles the ENTIRE self-registration flow atomically, server-side, with
// the service role key. This replaces doing it in two separate client-side
// steps (auth.signUp() then a students insert), which had a real bug: if
// the second step ever failed for any reason, the auth login created by
// the first step was never cleaned up. That orphaned login has no matching
// `students` row, so it's invisible everywhere in the admin UI (not in
// Students, not in Registrations) — but the email stays permanently locked
// in Supabase Auth, so any future registration attempt with that email
// fails with "already registered" and there's nothing visible to delete.
//
// This function creates the auth user, then inserts the students row, and
// if that second step fails for ANY reason, it deletes the auth user it
// just created before returning the error — so a failed registration
// attempt never leaves anything behind, and the email is immediately
// available to try again.
//
// Called with: supabase.functions.invoke('student-register', {
//   body: { name, room_number, mobile, email, password }
// })
// No Authorization header is required — the person registering doesn't
// have a session yet. This is the one Edge Function in the app that's
// intentionally open to anyone, same as the registration form itself.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { name, room_number, mobile, email, password } = await req.json();
    if (!name || !room_number || !mobile || !email || !password) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }
    if (password.length < 6) {
      return json(
        { ok: false, error: "Password must be at least 6 characters" },
        400,
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // email_confirm: true — no OTP/email-click verification anywhere in
    // this app; email is just a username, and admin approval (status =
    // 'pending' below) is the real gate on login.
    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (createError) {
      // surface Supabase's own "already registered" message as-is — if
      // this fires for an email nobody can see anywhere in the admin UI,
      // that's exactly the orphaned-login symptom this function exists to
      // prevent going forward; see supabase/CLEANUP_orphaned_auth_users.md
      // to find and clear any that were left behind before this fix.
      return json({ ok: false, error: createError.message }, 400);
    }

    const { error: insertError } = await adminClient.from("students").insert({
      id: created.user.id,
      name,
      room_number,
      mobile,
      email,
      status: "pending",
    });

    if (insertError) {
      // roll back — never leave an auth login with no matching students row
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, error: insertError.message }, 400);
    }

    return json({ ok: true });
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
