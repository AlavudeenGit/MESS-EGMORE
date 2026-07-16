// ============================================================================
// supabase/functions/admin-create-student/index.ts
// Lets an admin add a student directly (with login credentials) from the
// Admin -> Students screen, bypassing the self-registration approval flow.
// Requires the service role key, so this must run here, not in the browser.
//
// Called with: supabase.functions.invoke('admin-create-student', {
//   body: { name, room_number, mobile, email, password }
// })
// The caller's Supabase session JWT is forwarded automatically as the
// Authorization header — we verify it belongs to a row in `admins` before
// doing anything privileged.
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

    // client bound to the caller's own JWT — used only to verify who's calling
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

    // service-role client — only ever used server-side, never sent to the browser
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

    // create the auth user, pre-confirmed — no OTP/email-click step, matches
    // the self-registration flow's "email is just a username" behavior
    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (createError)
      return json({ ok: false, error: createError.message }, 400);

    const { error: insertError } = await adminClient.from("students").insert({
      id: created.user.id,
      name,
      room_number,
      mobile,
      email,
      status: "active",
    });
    if (insertError) {
      // roll back the auth user so we don't leave an orphaned login
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, error: insertError.message }, 400);
    }

    return json({ ok: true, student_id: created.user.id });
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
