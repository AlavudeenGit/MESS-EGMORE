// ============================================================================
// admin/dashboard.js — SPA router for the admin app + home overview
// ============================================================================
import { supabase, EXPENSE_CATEGORY_LABELS } from "../config.js";
import {
  requireRole,
  initTheme,
  toggleTheme,
  todayISO,
  currency,
  formatDate,
  effectiveMealStatus,
} from "../utils.js";
import { statCard } from "../components/Card.js";
import { openModal, closeModal } from "../components/Modal.js";
import { logout } from "../auth.js";
import { renderStudents } from "./students.js";
import { renderRegistrations } from "./registrations.js";
import { renderMeals } from "./meals.js";
import { renderAdminMenu } from "./menu.js";
import { renderExpenses } from "./expenses.js";
import { renderPayments } from "./payments.js";
import { renderReports } from "./reports.js";
import { renderSettings } from "./settings.js";

initTheme();
document.getElementById("themeToggle").addEventListener("click", toggleTheme);
document.getElementById("logoutBtn").addEventListener("click", logout);
document
  .getElementById("settingsShortcut")
  .addEventListener("click", () => navigate("settings"));

const MORE_ITEMS = [
  { view: "students", icon: "fa-users", label: "Students" },
  { view: "registrations", icon: "fa-user-plus", label: "Registrations" },
  { view: "menu", icon: "fa-book-open", label: "Weekly Menu" },
  { view: "expenses", icon: "fa-receipt", label: "Expenses" },
  { view: "settings", icon: "fa-gear", label: "Settings" },
];

document.getElementById("moreNavBtn").addEventListener("click", () => {
  const body = openModal({
    title: "More",
    bodyHTML: `
      <div style="display:flex;flex-direction:column;gap:2px;">
        ${MORE_ITEMS.map(
          (item) => `
          <button class="drawer-item" data-more-view="${item.view}">
            <i class="fa-solid ${item.icon}"></i> ${item.label}
          </button>
        `,
        ).join("")}
        <hr class="divider">
        <button class="drawer-item" id="moreLogout" style="color:var(--color-danger);">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Log Out
        </button>
      </div>
    `,
  });
  body.querySelectorAll("[data-more-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      navigate(btn.dataset.moreView);
    });
  });
  body.querySelector("#moreLogout").addEventListener("click", () => {
    closeModal();
    logout();
  });
});

const viewRoot = document.getElementById("viewRoot");
const viewTitle = document.getElementById("viewTitle");
const navButtons = [...document.querySelectorAll("[data-view]")];

let ctx = { profile: null, session: null };

const VIEWS = {
  home: { title: "Dashboard", render: renderHome },
  students: { title: "Students", render: renderStudents },
  registrations: { title: "Registrations", render: renderRegistrations },
  meals: { title: "Meal Entries", render: renderMeals },
  menu: { title: "Weekly Menu", render: renderAdminMenu },
  expenses: { title: "Expenses", render: renderExpenses },
  payments: { title: "Payments", render: renderPayments },
  reports: { title: "Reports", render: renderReports },
  settings: { title: "Settings", render: renderSettings },
};

export async function navigate(viewName) {
  const view = VIEWS[viewName] || VIEWS.home;
  navButtons.forEach((b) =>
    b.classList.toggle("is-active", b.dataset.view === viewName),
  );
  viewTitle.textContent = view.title;
  viewRoot.innerHTML = `<div class="skeleton" style="height:120px;border-radius:24px;"></div>`;
  try {
    await view.render(viewRoot, ctx);
  } catch (err) {
    console.error(err);
    viewRoot.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Something went wrong loading this page.</p></div>`;
  }
}
window.__adminNavigate = navigate; // used by home quick-links & cross-view links

async function boot() {
  const auth = await requireRole("admin");
  if (!auth) return;
  ctx.profile = auth.profile;
  ctx.session = auth.session;
  navButtons.forEach((btn) =>
    btn.addEventListener("click", () => navigate(btn.dataset.view)),
  );
  navigate("home");
}

// ---- HOME VIEW ----------------------------------------------------------------
async function renderHome(root) {
  const today = todayISO();
  const monthStart = today.slice(0, 7) + "-01";

  const [
    { count: totalStudents },
    { count: activeStudents },
    { count: pendingRegs },
    { data: todayRows },
    { data: monthExpenses },
    { data: monthPayments },
    { data: recentStudents },
    { data: recentExpenses },
  ] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("bookings")
      .select("meal_type, booking_status, confirmed_status")
      .eq("date", today),
    supabase.from("expenses").select("amount").gte("date", monthStart),
    supabase
      .from("payments")
      .select("paid_amount")
      .eq("month_year", monthStart),
    supabase
      .from("students")
      .select("name, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("expenses")
      .select("category, amount, date")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // effective count — confirmed_status if the student has confirmed
  // something (e.g. via No Food), otherwise falls back to booking_status.
  // This is the SAME logic Meal Entries and Reports use (see
  // utils.js:effectiveMealStatus), so this card can never drift from them
  // the way separate "Booked" and "Confirmed" rows could — that previous
  // design also had a real bug where a No Food confirmation counted as a
  // positive number here, which it shouldn't.
  const todayCounts = countByMeal(todayRows);
  const totalExpenseAmt = sumAmount(monthExpenses);
  const totalRevenueAmt = (monthPayments || []).reduce(
    (s, p) => s + Number(p.paid_amount || 0),
    0,
  );
  const profit = totalRevenueAmt - totalExpenseAmt;

  root.innerHTML = `
    <div class="card-grid">
      ${statCard({ label: "Total Students", value: totalStudents ?? 0, icon: "fa-users" })}
      ${statCard({ label: "Active", value: activeStudents ?? 0, icon: "fa-user-check" })}
      ${statCard({ label: "Pending Registrations", value: pendingRegs ?? 0, icon: "fa-user-clock" })}
      ${statCard({ label: "Monthly Revenue", value: currency(totalRevenueAmt), icon: "fa-arrow-trend-up" })}
      ${statCard({ label: "Monthly Expenses", value: currency(totalExpenseAmt), icon: "fa-arrow-trend-down" })}
      ${statCard({ label: "Profit / Loss", value: currency(profit), icon: "fa-scale-balanced" })}
    </div>

    <div class="card">
      <h3>Today's Meals <span class="badge badge-locked">${formatDate(today)}</span></h3>
      <p class="text-soft" style="font-size:12px;margin-bottom:10px;">Same numbers as Admin → Meal Entries for today — both read the exact same effective status per meal, so they can't drift apart.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Breakfast</th><th>Lunch</th><th>Dinner</th></tr></thead>
          <tbody>
            <tr>
              <td data-label="Breakfast">${todayCounts.breakfast}</td>
              <td data-label="Lunch">${todayCounts.lunch}</td>
              <td data-label="Dinner">${todayCounts.dinner}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Recent Activity</h3>
      <div class="activity-feed">
        ${(recentStudents || []).map((s) => activityRow("fa-user-plus", `${s.name} registered`, s.created_at)).join("")}
        ${(recentExpenses || []).map((e) => activityRow("fa-receipt", `${EXPENSE_CATEGORY_LABELS[e.category]} expense of ${currency(e.amount)}`, e.date)).join("")}
      </div>
    </div>
  `;
}

function activityRow(icon, text, when) {
  return `<div class="activity-item">
    <div class="activity-item__icon"><i class="fa-solid ${icon}"></i></div>
    <div><div class="activity-item__text">${text}</div><div class="activity-item__time">${formatDate((when || "").slice(0, 10))}</div></div>
  </div>`;
}

function countByMeal(rows, field) {
  const out = { breakfast: 0, lunch: 0, dinner: 0 };
  (rows || []).forEach((r) => {
    out[r.meal_type] += mealCountValue(r[field]);
  });
  return out;
}
function mealCountValue(status) {
  if (status === "double") return 2;
  if (status && status !== "no") return 1;
  return 0;
}
function sumAmount(rows) {
  return (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

boot();
