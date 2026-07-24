// ============================================================================
// student/confirmation.js — "today" meal confirmation.
//
// New behavior: a meal is pre-filled with what was booked yesterday, and is
// NOT editable at all unless the admin has enabled No Food for that specific
// meal (Admin -> Settings -> No Food Option). This is enforced twice over —
// the client hides the option group entirely for a non-editable meal, and
// the database trigger (enforce_booking_write in sql/schema.sql) rejects any
// confirmed_status write for a meal where No Food is disabled, regardless of
// what a manipulated API call sends. Meals left untouched this way are
// auto-confirmed to match the booking by the nightly lock-confirmations
// sweep (see supabase/functions/lock-confirmations), so the fine
// calculation always sees a real value instead of "never confirmed."
//
// For meals that ARE editable: tapping an option only updates local
// selection (highlights it) — no API call yet. A single Submit button sends
// everything changed in one batch call. Both selecting and submitting are
// gated to the shared booking_open_time–booking_close_time window, checked
// against the DATABASE's clock via get_meal_window_status() — not the
// device's — so changing a phone's date/time can't unlock anything.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { todayISO, getServerWindowStatus, getSettings } from "../utils.js";
import { toast } from "../components/Toast.js";

export async function renderConfirmationPanel(container, ctx) {
  const today = todayISO();
  const [windowStatus, settings] = await Promise.all([
    getServerWindowStatus(),
    getSettings(),
  ]);
  const windowOpen = windowStatus.is_open;

  const { data: rows, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("student_id", ctx.profile.id)
    .eq("date", today);

  if (error) {
    container.innerHTML = `<p class="text-danger">Could not load today's status.</p>`;
    return;
  }

  const byMeal = {};
  MEAL_TYPES.forEach((m) => {
    byMeal[m] = rows.find((r) => r.meal_type === m) || null;
  });

  // local, unsaved selection state — pre-filled from what's already
  // confirmed, falling back to yesterday's booking (the auto-fill)
  const selection = {};
  MEAL_TYPES.forEach((m) => {
    selection[m] =
      byMeal[m]?.confirmed_status || byMeal[m]?.booking_status || null;
  });

  const anyEditable = MEAL_TYPES.some((m) =>
    isEditable(byMeal[m], settings, windowOpen),
  );

  container.innerHTML = `
    <div class="deadline-banner ${windowOpen ? "" : "is-locked"}">
      <i class="fa-solid ${windowOpen ? "fa-clock" : "fa-lock"}"></i>
      ${
        windowOpen
          ? `Confirm before ${formatWindowLabel(windowStatus.window_close)} tonight.`
          : `Meal selection is only open ${formatWindowLabel(windowStatus.window_open)}–${formatWindowLabel(windowStatus.window_close)} (server time).`
      }
    </div>
    ${MEAL_TYPES.map((meal) => mealCardHTML(meal, byMeal[meal], selection[meal], windowOpen, settings)).join("")}
    ${anyEditable ? `<button class="btn btn-primary btn-block" id="submitConfirmation"><i class="fa-solid fa-check"></i> Submit Confirmation</button>` : ""}
  `;

  MEAL_TYPES.forEach((meal) =>
    wireMealCardSelection(
      container,
      meal,
      byMeal[meal],
      selection,
      windowOpen,
      settings,
    ),
  );

  const submitBtn = container.querySelector("#submitConfirmation");
  if (submitBtn) {
    submitBtn.addEventListener("click", () =>
      submitConfirmations(container, ctx, today, byMeal, selection, settings),
    );
  }
}

function formatWindowLabel(hhmm) {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** a meal is editable only when: not locked/cancelled, window is open, AND
 *  the admin has enabled No Food for it. Otherwise it's frozen to whatever
 *  was booked yesterday. */
function isEditable(row, settings, windowOpen) {
  if (row?.confirmation_locked || row?.cancelled_by_admin) return false;
  if (!windowOpen) return false;
  return (
    settings[`no_food_enabled_${row ? row.meal_type : ""}`] === "true" || false
  );
}

function mealCardHTML(meal, row, selectedValue, windowOpen, settings) {
  const locked = row?.confirmation_locked || row?.cancelled_by_admin;
  const bookedStatus = row?.booking_status;
  const noFoodEnabled = settings[`no_food_enabled_${meal}`] === "true";
  const editable = !locked && windowOpen && noFoodEnabled;

  if (!editable) {
    // frozen to the booking — no option group, nothing to tap
    const displayValue = row?.confirmed_status || row?.booking_status;
    return `
      <div class="card meal-card" data-meal="${meal}">
        <div class="meal-card__head">
          <span class="meal-name">${MEAL_LABELS[meal]}</span>
          ${
            row?.cancelled_by_admin
              ? '<span class="badge badge-no">Cancelled</span>'
              : bookedStatus
                ? `<span class="badge badge-${bookedStatus}">Booked: ${STATUS_LABELS[bookedStatus]}</span>`
                : '<span class="badge badge-locked">Not booked</span>'
          }
        </div>
        ${displayValue ? `<div class="option-group"><span class="option-btn is-selected" data-value="${displayValue}" disabled>${STATUS_LABELS[displayValue]}</span></div>` : ""}
        <p class="text-soft" style="font-size:12px;margin:8px 0 0;">
          <i class="fa-solid fa-lock"></i>
          ${
            row?.confirmation_locked
              ? "Already finalized — locked"
              : row?.cancelled_by_admin
                ? "Cancelled by admin"
                : !windowOpen
                  ? "Selection window is closed"
                  : "Locked to your booking — No Food isn't available for this meal"
          }
        </p>
      </div>
    `;
  }

  const options = ["yes", "no", "no_food", "double"];
  return `
    <div class="card meal-card" data-meal="${meal}">
      <div class="meal-card__head">
        <span class="meal-name">${MEAL_LABELS[meal]}</span>
        ${bookedStatus ? `<span class="badge badge-${bookedStatus}">Booked: ${STATUS_LABELS[bookedStatus]}</span>` : '<span class="badge badge-locked">Not booked</span>'}
      </div>
      <div class="option-group option-group--4">
        ${options
          .map(
            (opt) => `
          <button class="option-btn ${selectedValue === opt ? "is-selected" : ""}" data-value="${opt}">${STATUS_LABELS[opt]}</button>
        `,
          )
          .join("")}
      </div>
      <p class="text-soft" style="font-size:12px;margin:8px 0 0;"><i class="fa-solid fa-circle-info"></i> No Food is available for this meal — you can change it before submitting.</p>
    </div>
  `;
}

function wireMealCardSelection(
  container,
  meal,
  row,
  selection,
  windowOpen,
  settings,
) {
  if (!isEditable({ ...row, meal_type: meal }, settings, windowOpen)) return;
  const card = container.querySelector(`[data-meal="${meal}"]`);
  if (!card) return;
  card.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // local selection only — no API call here
      card
        .querySelectorAll(".option-btn")
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selection[meal] = btn.dataset.value;
    });
  });
}

async function submitConfirmations(
  container,
  ctx,
  date,
  byMeal,
  selection,
  settings,
) {
  const submitBtn = container.querySelector("#submitConfirmation");
  const changed = MEAL_TYPES.filter((m) => {
    const row = byMeal[m];
    if (!isEditable({ ...row, meal_type: m }, settings, true)) return false;
    const current = row?.confirmed_status || row?.booking_status || null;
    return selection[m] && selection[m] !== current;
  });

  if (!changed.length) {
    toast.info(
      "Select a different option for at least one editable meal before submitting.",
    );
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

  const payload = changed.map((meal) => ({
    student_id: ctx.profile.id,
    date,
    meal_type: meal,
    confirmed_status: selection[meal],
    confirmation_locked: true,
    confirmed_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("bookings")
    .upsert(payload, { onConflict: "student_id,date,meal_type" });

  if (error) {
    // surface the real reason (e.g. "Meal selection window is closed" from
    // enforce_booking_write) instead of a generic message — this matters
    // most exactly when a tampered device clock made the UI think the
    // window was open but the server (correctly) disagreed.
    toast.error(
      error.message || "Could not save your confirmation. Please try again.",
    );
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<i class="fa-solid fa-check"></i> Submit Confirmation';
    await renderConfirmationPanel(container, ctx);
    return;
  }

  await supabase.rpc("recompute_daily_fine", {
    p_student_id: ctx.profile.id,
    p_date: date,
  });
  toast.success("Confirmation submitted");
  await renderConfirmationPanel(container, ctx);
}
