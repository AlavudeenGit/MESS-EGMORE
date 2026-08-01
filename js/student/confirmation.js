// ============================================================================
// student/confirmation.js — "today" meal confirmation.
//
// A meal is pre-filled ("patched") with what was booked yesterday, and is
// NOT editable at all unless the admin has enabled No Food for that specific
// meal (Admin -> Settings -> No Food Option). When it IS editable, only two
// choices are offered: the patched value itself, or "No Food" — nothing
// else. This is intentionally independent of Tomorrow's Booking (see
// js/student/booking.js): Today's Confirmation has NO time-of-day window at
// all, only "already submitted" (confirmation_locked) or "admin cancelled"
// can freeze it. Previously both tabs shared one evening window, which
// meant the window simply closing due to normal time passing could make
// Tomorrow's Booking look locked right after submitting Today's
// Confirmation, even though nothing about that submission caused it. They
// now share NO state or settings key at all, so one can never affect the
// other's editability.
//
// Enforced twice over: the client hides the option group entirely for a
// non-editable meal, and the database trigger (enforce_booking_write in
// sql/schema.sql) rejects any confirmed_status write for a meal where No
// Food is disabled, regardless of what a manipulated API call sends.
// Meals left untouched this way are auto-confirmed to match the booking by
// the nightly lock-confirmations sweep (see supabase/functions/lock-confirmations).
//
// Tapping an option only updates local selection (highlights it) — no API
// call yet. A single Submit button sends everything changed in one batch
// call, and locks ONLY Today's Confirmation — Tomorrow's Booking rows are a
// completely separate date, untouched by this write.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { todayISO, getSettings } from "../utils.js";
import { toast } from "../components/Toast.js";

export async function renderConfirmationPanel(container, ctx) {
  const today = todayISO();
  const settings = await getSettings();

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
    selection[m] =
      byMeal[m]?.confirmed_status || byMeal[m]?.booking_status || null;
  });

  const anyEditable = MEAL_TYPES.some((m) => isEditable(byMeal[m], settings));

  container.innerHTML = `
    ${MEAL_TYPES.map((meal) => mealCardHTML(meal, byMeal[meal], selection[meal], settings)).join("")}
    ${anyEditable ? `<button class="btn btn-primary btn-block" id="submitConfirmation"><i class="fa-solid fa-check"></i> Submit Confirmation</button>` : ""}
  `;

  MEAL_TYPES.forEach((meal) =>
    wireMealCardSelection(container, meal, byMeal[meal], selection, settings),
  );

  const submitBtn = container.querySelector("#submitConfirmation");
  if (submitBtn) {
    submitBtn.addEventListener("click", () =>
      submitConfirmations(container, ctx, today, byMeal, selection, settings),
    );
  }
}

/** a meal is editable only when: not already submitted/cancelled, AND the
 *  admin has enabled No Food for it. No time-of-day check at all — that's
 *  deliberately Tomorrow Booking's concern only, never Today Confirmation's. */
function isEditable(row, settings) {
  if (row?.confirmation_locked || row?.cancelled_by_admin) return false;
  return (
    settings[`no_food_enabled_${row ? row.meal_type : ""}`] === "true" || false
  );
}

function mealCardHTML(meal, row, selectedValue, settings) {
  const locked = row?.confirmation_locked || row?.cancelled_by_admin;
  const bookedStatus = row?.booking_status;
  const editable = isEditable({ ...row, meal_type: meal }, settings);

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
              ? "Already submitted — locked"
              : row?.cancelled_by_admin
                ? "Cancelled by admin"
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

function wireMealCardSelection(container, meal, row, selection, settings) {
  if (!isEditable({ ...row, meal_type: meal }, settings)) return;
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
    if (!isEditable({ ...row, meal_type: m }, settings)) return false;
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

  // this only ever writes rows for `date` (today) — Tomorrow's Booking
  // lives on a completely different date and is never touched here
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
