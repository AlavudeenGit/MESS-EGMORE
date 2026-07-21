// ============================================================================
// utils.js — shared helpers used across student + admin modules
// ============================================================================
import { supabase, DEFAULT_SETTINGS } from "./config.js";

// ---- date helpers -----------------------------------------------------------
export function todayISO() {
  return toISO(new Date());
}
export function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toISO(d);
}
export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function formatDate(iso, opts = {}) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...opts,
  });
}
export function isoDayOfWeek(iso) {
  // returns 1 (Mon) .. 7 (Sun) to match menu.day_of_week
  const d = new Date(iso + "T00:00:00");
  const js = d.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}
export function monthStartISO(year, month /* 1-12 */) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
export function currentTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** true if current time is between `open` and `close` (both "HH:MM", may span midnight) */
export function isWithinWindow(open, close) {
  const now = currentTimeHHMM();
  if (open <= close) return now >= open && now <= close;
  return now >= open || now <= close; // spans midnight
}
export function isPastDeadline(deadlineHHMM) {
  return currentTimeHHMM() > deadlineHHMM;
}

/**
 * Asks the DATABASE (not the device) whether the meal selection window is
 * open right now, via the get_meal_window_status() SQL function. This is
 * what closes the "change my phone's clock to bypass the window" loophole
 * at the UI layer — enforce_booking_write() in sql/schema.sql already made
 * this impossible to bypass for the actual write (Postgres's own clock
 * decides, unconditionally), but without this, a tampered device could
 * still show enabled buttons that would only fail once submitted. Calling
 * this makes the UI itself reflect the true server-side state.
 * Falls back to the device clock only if the RPC call itself fails (e.g.
 * offline) — enforce_booking_write() remains the real safety net either way.
 */
export async function getServerWindowStatus() {
  const { data, error } = await supabase.rpc("get_meal_window_status");
  if (error || !data || !data[0]) {
    console.error(
      "get_meal_window_status failed, falling back to device clock",
      error,
    );
    const settings = await getSettings();
    return {
      is_open: isWithinWindow(
        settings.booking_open_time,
        settings.booking_close_time,
      ),
      window_open: settings.booking_open_time,
      window_close: settings.booking_close_time,
      fallback: true,
    };
  }
  const row = data[0];
  return {
    is_open: row.is_open,
    server_date: row.server_date,
    server_time: row.server_time,
    window_open: row.window_open,
    window_close: row.window_close,
    fallback: false,
  };
}

// ---- settings cache -----------------------------------------------------------
let _settingsCache = null;
export async function getSettings(force = false) {
  if (_settingsCache && !force) return _settingsCache;
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error || !data) {
    console.error("getSettings error", error);
    _settingsCache = { ...DEFAULT_SETTINGS };
    return _settingsCache;
  }
  const merged = { ...DEFAULT_SETTINGS };
  data.forEach((row) => {
    merged[row.key] = row.value;
  });
  _settingsCache = merged;
  return merged;
}
export function invalidateSettingsCache() {
  _settingsCache = null;
}

// ---- theme (dark mode) ---------------------------------------------------------
export function initTheme() {
  const saved = localStorage.getItem("mess_theme");
  if (saved === "dark")
    document.documentElement.setAttribute("data-theme", "dark");
}
export function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("mess_theme", "light");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("mess_theme", "dark");
  }
}

// ---- misc ------------------------------------------------------------------------
export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
export function currency(n) {
  const num = Number(n || 0);
  return (
    "₹" +
    num.toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}
export function initials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
export function capitalize(s = "") {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- export helpers (Excel via SheetJS, PDF via jsPDF) ---------------------------
/**
 * rows: array of plain objects (keys become column headers)
 * filename: without extension
 */
export function exportToExcel(rows, filename = "export") {
  if (!rows || !rows.length) {
    return;
  }
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Report");
  window.XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * columns: [{ key, label }], rows: array of plain objects
 */
export function exportToPDF(
  columns,
  rows,
  title = "Report",
  filename = "export",
) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: columns.length > 6 ? "landscape" : "portrait",
  });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, 14, 22);

  const head = [columns.map((c) => c.label)];
  const body = rows.map((r) => columns.map((c) => String(r[c.key] ?? "")));

  if (doc.autoTable) {
    doc.autoTable({ head, body, startY: 28, styles: { fontSize: 8 } });
  } else {
    // fallback: plain text dump if autotable plugin isn't loaded
    let y = 30;
    body.forEach((row) => {
      doc.text(row.join(" | "), 14, y);
      y += 6;
    });
  }
  doc.save(`${filename}.pdf`);
}

export function printElement(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>Print</title>
    <link rel="stylesheet" href="css/main.css"></head>
    <body>${el.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ---- session guard -----------------------------------------------------------------
/**
 * Ensures a logged-in session exists and that the user has the expected role.
 * role: 'student' | 'admin'
 * Redirects to index.html if not authenticated or wrong role.
 */
export async function requireRole(role) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  const table = role === "admin" ? "admins" : "students";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) {
    await supabase.auth.signOut();
    window.location.href = "index.html";
    return null;
  }
  if (role === "student" && data.status !== "active") {
    await supabase.auth.signOut();
    window.location.href = "index.html?pending=1";
    return null;
  }
  return { session, profile: data };
}
