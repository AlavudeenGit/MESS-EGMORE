// ============================================================================
// auth.js — login, self-registration request, logout, role-based redirect
// ============================================================================
import { supabase } from "./config.js";
import { toast } from "./components/Toast.js";

/** Logs in and redirects to the correct dashboard based on role. */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    toast.error(error.message || "Login failed");
    return false;
  }

  const uid = data.user.id;

  // check admin first
  const { data: admin } = await supabase
    .from("admins")
    .select("id")
    .eq("id", uid)
    .maybeSingle();
  if (admin) {
    window.location.href = "admin-dashboard.html";
    return true;
  }

  // then student
  const { data: student } = await supabase
    .from("students")
    .select("status")
    .eq("id", uid)
    .maybeSingle();
  if (student) {
    if (student.status === "active") {
      window.location.href = "student-dashboard.html";
      return true;
    }
    if (student.status === "pending") {
      toast.error("Your registration is still pending admin approval.");
    } else {
      toast.error("Your account is inactive. Contact the admin.");
    }
    await supabase.auth.signOut();
    return false;
  }

  toast.error("No account found for this login.");
  await supabase.auth.signOut();
  return false;
}

/**
 * Student self-registration (link shared by admin — not publicly discoverable).
 * Creates an auth user + a `students` row with status = 'pending'.
 * The row only becomes usable once an admin approves it (Registration Approval page).
 *
 * No OTP / email-click verification is used anywhere in this flow — email is
 * just a username. Make sure "Confirm email" is turned OFF in the Supabase
 * dashboard (Authentication -> Providers -> Email), see README.md. The real
 * gate on login is `students.status = 'active'`, set by an admin approval.
 */
export async function submitRegistration({
  name,
  room_number,
  mobile,
  email,
  password,
}) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    toast.error(error.message || "Could not create account");
    return false;
  }
  if (!data.user) {
    toast.error("Registration failed — please try again");
    return false;
  }

  const { error: insertError } = await supabase.from("students").insert({
    id: data.user.id,
    name,
    room_number,
    mobile,
    email,
    status: "pending",
  });

  if (insertError) {
    toast.error("Could not save your details: " + insertError.message);
    return false;
  }

  toast.success(
    "Registration submitted! Wait for admin approval before logging in.",
  );
  return true;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

/** If already logged in, skip the login screen and go straight to the right dashboard. */
export async function redirectIfLoggedIn() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;
  const uid = session.user.id;
  const { data: admin } = await supabase
    .from("admins")
    .select("id")
    .eq("id", uid)
    .maybeSingle();
  if (admin) {
    window.location.href = "admin-dashboard.html";
    return;
  }
  const { data: student } = await supabase
    .from("students")
    .select("status")
    .eq("id", uid)
    .maybeSingle();
  if (student && student.status === "active") {
    window.location.href = "student-dashboard.html";
  }
}
