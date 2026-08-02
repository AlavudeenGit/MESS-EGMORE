// ============================================================================
// student/dashboard.js — SPA router for the student app. Mounts one of:
// home (this file), markfood (booking.js + confirmation.js tabs), menu.js,
// history.js, profile (this file) into #viewRoot based on nav clicks.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS } from "../config.js";
import {
  requireRole,
  todayISO,
  tomorrowISO,
  initTheme,
  toggleTheme,
  formatDate,
  effectiveMealStatus,
} from "../utils.js";
import { toast } from "../components/Toast.js";
import { thaliRing } from "../components/Card.js";
import { logout } from "../auth.js";
import { renderMarkFood } from "./booking.js";
import { renderMenu } from "./menu.js";
import { renderHistory } from "./history.js";

initTheme();
document.getElementById("themeToggle").addEventListener("click", toggleTheme);
document.getElementById("logoutBtn").addEventListener("click", logout);

const viewRoot = document.getElementById("viewRoot");
const viewTitle = document.getElementById("viewTitle");
const navButtons = [...document.querySelectorAll("[data-view]")];

let ctx = { profile: null, session: null };

const VIEWS = {
  home: { title: "Dashboard", render: renderHome },
  markfood: { title: "Mark Food", render: renderMarkFood },
  menu: { title: "Weekly Menu", render: renderMenu },
  history: { title: "History", render: renderHistory },
  profile: { title: "Profile", render: renderProfile },
};

async function boot() {
  const auth = await requireRole("student");
  if (!auth) return;
  ctx.profile = auth.profile;
  ctx.session = auth.session;
  navButtons.forEach((btn) =>
    btn.addEventListener("click", () => navigate(btn.dataset.view)),
  );
  const initial =
    new URLSearchParams(location.hash.slice(1)).get("v") || "home";
  navigate(initial);
}

async function navigate(viewName) {
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

// ---- HOME VIEW --------------------------------------------------------------
async function renderHome(root, ctx) {
  const today = todayISO();
  const tomorrow = tomorrowISO();

  const [{ data: todayRows }, { data: tomorrowRows }] = await Promise.all([
    supabase
      .from("bookings")
      .select("*")
      .eq("student_id", ctx.profile.id)
      .eq("date", today),
    supabase
      .from("bookings")
      .select("*")
      .eq("student_id", ctx.profile.id)
      .eq("date", tomorrow),
  ]);

  const confirmStatuses = {};
  MEAL_TYPES.forEach((m) => {
    const row = (todayRows || []).find((r) => r.meal_type === m);
    confirmStatuses[m] = effectiveMealStatus(row) || "pending";
  });

  const bookedCount = (tomorrowRows || []).filter(
    (r) => r.booking_status,
  ).length;

  root.innerHTML = `
    <section class="status-hero">
      <div class="status-hero__greeting">Hi ${ctx.profile.name.split(" ")[0]}, here's today</div>
      <h2 style="color:#fff;margin-bottom:16px;">${formatDate(today)}</h2>
      ${thaliRing(confirmStatuses, { size: 116, stroke: 16 })}
    </section>

    <div class="card-grid">
      <div class="card"><div class="card__label">Tomorrow booked</div><div class="card__value">${bookedCount}/3</div></div>
    </div>

    <div class="card">
      <h3>Quick actions</h3>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
        <button class="btn btn-primary btn-block" data-nav="markfood"><i class="fa-solid fa-utensils"></i> Confirm / Book Meals</button>
        <button class="btn btn-secondary btn-block" data-nav="menu"><i class="fa-solid fa-book-open"></i> View Weekly Menu</button>
      </div>
      
      </div>
      <small style="font-size:10px; opacity:0.5;">
  Developed By : Mohamed Alavudeen - 9360302955
</small>
  `;

  root.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });
}

// ---- PROFILE VIEW -------------------------------------------------------------
async function renderProfile(root, ctx) {
  const p = ctx.profile;
  root.innerHTML = `
    <div class="card" style="text-align:center;">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--color-primary-soft);color:var(--color-primary);
        display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:26px;font-weight:700;
        margin:0 auto 12px;">${p.name
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}</div>
      <h2>${p.name}</h2>
      <p class="text-soft">Room ${p.room_number}</p>
    </div>
    <div class="card">
      <div class="field"><input value="${p.email}" disabled placeholder=" "><label>Email</label></div>
      <div class="field"><input value="${p.mobile}" disabled placeholder=" "><label>Mobile</label></div>
      <div class="field"><input value="${p.room_number}" disabled placeholder=" "><label>Room number</label></div>
      <div class="field"><input value="${formatDate(p.joined_at)}" disabled placeholder=" "><label>Joined</label></div>
      <p class="text-soft" style="font-size:12px;">To update these details, contact your mess admin.</p>
    </div>
    <button class="btn btn-danger btn-block" id="profileLogout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Log Out</button>
  `;
  root.querySelector("#profileLogout").addEventListener("click", logout);
}

boot();
