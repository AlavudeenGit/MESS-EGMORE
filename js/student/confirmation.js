// ============================================================================
// student/confirmation.js — "today" meal confirmation.
//
// Respects the same shared meal-selection window (default 8:30–11:30 PM
// server time) as Tomorrow's Booking — see js/student/booking.js and
// utils.js:getServerWindowStatus(), which asks the DATABASE's clock, not
// the device's, so it can't be bypassed by changing a phone's date/time.
// When the window is closed, nothing here is editable and the submit
// button is hidden — but this doesn't affect Tomorrow's Booking's own
// editability or vice versa; each screen checks the window independently
// and neither write ever touches the other's date.
//
// A meal is pre-filled ("patched") with what was booked yesterday, and is
// NOT editable unless BOTH of these are true:
//   1. The admin has enabled No Food for that specific meal (Admin ->
//      Settings -> No Food Option), and
//   2. The shared window above is currently open.
// When editable, only two choices are offered: the patched value itself,
// or "No Food" — nothing else.
//
// Enforced twice over: the client hides the option group entirely when
// either condition fails, and the database trigger (enforce_booking_write
// in sql/schema.sql) independently re-checks both — the window using
// Postgres's own clock, and No Food using the same per-meal setting —
// rejecting any confirmed_status write that doesn't satisfy both,
// regardless of what a manipulated API call sends.
//
// Once submitted, a meal locks immediately (confirmation_locked) and stays
// locked regardless of the window afterward. Meals left untouched because
// No Food was never enabled for them are auto-confirmed to match the
// booking by the nightly lock-confirmations sweep (see
// supabase/functions/lock-confirmations).
//
// Tapping an option only updates local selection (highlights it) — no API
// call yet. A single Submit button sends everything changed in one batch
// call, and only ever writes rows for TODAY — Tomorrow's Booking lives on
// a completely different date and is never touched here.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import {
  todayISO,
  getSettings,
  getServerWindowStatus,
  effectiveMealStatus,
} from "../utils.js";
import { toast } from "../components/Toast.js";

export async function renderConfirmationPanel(container, ctx) {
  const today = todayISO();
  const [settings, windowStatus] = await Promise.all([
    getSettings(),
    getServerWindowStatus(),
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
  // confirmed, falling back to yesterday's booking (the "patched" value)
  const selection = {};
  MEAL_TYPES.forEach((m) => {
    selection[m] = effectiveMealStatus(byMeal[m]);
  });

  const anyEditable = MEAL_TYPES.some((m) =>
    isEditable(byMeal[m], settings, windowOpen),
  );

  container.innerHTML = `
    <div class="deadline-banner ${windowOpen ? "" : "is-locked"}">
      <i class="fa-solid ${windowOpen ? "fa-clock" : "fa-lock"}"></i>
      ${
        windowOpen
          ? `Confirmation window open until ${formatWindowLabel(windowStatus.window_close)} tonight (same window as Tomorrow's Booking).`
          : `Confirmation is only open ${formatWindowLabel(windowStatus.window_open)}–${formatWindowLabel(windowStatus.window_close)} (server time).`
      }
    </div>
    ${MEAL_TYPES.map((meal) => mealCardHTML(meal, byMeal[meal], selection[meal], settings, windowOpen)).join("")}
    ${anyEditable && windowOpen ? `<button class="btn btn-primary btn-block" id="submitConfirmation"><i class="fa-solid fa-check"></i> Submit Confirmation</button>` : ""}
  `;

  MEAL_TYPES.forEach((meal) =>
    wireMealCardSelection(
      container,
      meal,
      byMeal[meal],
      selection,
      settings,
      windowOpen,
    ),
  );

  const submitBtn = container.querySelector("#submitConfirmation");
  if (submitBtn) {
    submitBtn.addEventListener("click", () =>
      submitConfirmations(
        container,
        ctx,
        today,
        byMeal,
        selection,
        settings,
        windowOpen,
      ),
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

/** a meal is editable only when: the shared window is currently open, it's
 *  not already submitted/cancelled, AND the admin has enabled No Food
 *  for it. */
function isEditable(row, settings, windowOpen) {
  if (!windowOpen) return false;
  if (row?.confirmation_locked || row?.cancelled_by_admin) return false;
  return (
    settings[`no_food_enabled_${row ? row.meal_type : ""}`] === "true" || false
  );
}

function mealCardHTML(meal, row, selectedValue, settings, windowOpen) {
  const bookedStatus = row?.booking_status;
  const editable = isEditable(
    { ...row, meal_type: meal },
    settings,
    windowOpen,
  );

  if (!editable) {
    // frozen to the booking — no option group, nothing to tap
    const displayValue = effectiveMealStatus(row);
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
              ? "Already submitted — locked"
              : row?.cancelled_by_admin
                ? "Cancelled by admin"
                : !windowOpen
                  ? "Confirmation window is closed"
                  : "Locked to your booking — No Food isn't available for this meal"
          }
        </p>
      </div>
    `;
  }

  // ONLY two choices when editable: the patched (booked) value, or No
  // Food — nothing else. Falls back to "No" alongside No Food on the rare
  // case there's no booking at all to patch in.
  const options = bookedStatus
    ? [...new Set([bookedStatus, "no_food"])]
    : ["no", "no_food"];
  return `
    <div class="card meal-card" data-meal="${meal}">
      <div class="meal-card__head">
        <span class="meal-name">${MEAL_LABELS[meal]}</span>
        ${bookedStatus ? `<span class="badge badge-${bookedStatus}">Booked: ${STATUS_LABELS[bookedStatus]}</span>` : '<span class="badge badge-locked">Not booked</span>'}
      </div>
      <div class="option-group" style="grid-template-columns: repeat(${options.length}, 1fr);">
        ${options
          .map(
            (opt) => `
          <button class="option-btn ${selectedValue === opt ? "is-selected" : ""}" data-value="${opt}">${STATUS_LABELS[opt]}</button>
        `,
          )
          .join("")}
      </div>
      <p class="text-soft" style="font-size:12px;margin:8px 0 0;"><i class="fa-solid fa-circle-info"></i> No Food is available for this meal — keep your booked value or switch to No Food before submitting.</p>
    </div>
  `;
}

function wireMealCardSelection(
  container,
  meal,
  row,
  selection,
  settings,
  windowOpen,
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
  windowOpen,
) {
  // Note: this re-checks the SAME windowOpen value captured at render time
  // (the button doesn't exist in the DOM at all if it was false, so this
  // branch is normally unreachable) — it's not a fresh server check. The
  // real protection against the window closing mid-session is the database
  // trigger, which checks Postgres's own clock at write time regardless of
  // what the client believes.
  if (!windowOpen) {
    toast.error("The confirmation window is now closed.");
    return;
  }

  const submitBtn = container.querySelector("#submitConfirmation");

  // submit every EDITABLE meal with a real selection — no requirement that
  // it differ from the patched value. Confirming "yes, that's still right"
  // is just as valid a submission as switching to No Food.
  const toSubmit = MEAL_TYPES.filter((m) => {
    const row = byMeal[m];
    if (!isEditable({ ...row, meal_type: m }, settings, windowOpen))
      return false;
    return !!selection[m];
  });

  if (!toSubmit.length) {
    toast.info("No meals are open for confirmation right now.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

  // this only ever writes rows for `date` (today) — Tomorrow's Booking
  // lives on a completely different date and is never touched here, even
  // though both features share the same window's open/close times
  const payload = toSubmit.map((meal) => ({
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
    // if the window closed server-side between render and submit, this is
    // exactly where that gets caught — the trigger rejects it even though
    // the client's stale windowOpen said it should be fine
    toast.error(
      error.message || "Could not save your confirmation. Please try again.",
    );
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<i class="fa-solid fa-check"></i> Submit Confirmation';
    await renderConfirmationPanel(container, ctx);
    return;
  }

  toast.success(
    "Confirmation submitted — locked. Tomorrow's Booking is unaffected.",
  );
  await renderConfirmationPanel(container, ctx);
}
