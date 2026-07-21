// ============================================================================
// student/confirmation.js — "today" meal confirmation (Yes / No / Double Food)
//
// Behavior:
//   - Tapping an option only updates the LOCAL selection (highlights it) —
//     no API call happens yet.
//   - A single Submit button at the bottom sends everything that changed in
//     one batch call.
//   - Both selecting and submitting are only allowed inside the shared
//     booking_open_time–booking_close_time window (default 8:30–11:30 PM),
//     and that window is checked against the DATABASE's clock via
//     get_meal_window_status() — not the device's clock — so changing a
//     phone's date/time can't unlock anything. See
//     sql/schema.sql:get_meal_window_status() / enforce_booking_write().
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

  // local, unsaved selection state — starts from whatever's already confirmed
  const selection = {};
  MEAL_TYPES.forEach((m) => {
    selection[m] = byMeal[m]?.confirmed_status || null;
  });

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
    ${windowOpen ? `<button class="btn btn-primary btn-block" id="submitConfirmation"><i class="fa-solid fa-check"></i> Submit Confirmation</button>` : ""}
  `;

  MEAL_TYPES.forEach((meal) =>
    wireMealCardSelection(container, meal, byMeal[meal], selection, windowOpen),
  );

  const submitBtn = container.querySelector("#submitConfirmation");
  if (submitBtn) {
    submitBtn.addEventListener("click", () =>
      submitConfirmations(container, ctx, today, byMeal, selection),
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

function mealCardHTML(meal, row, selectedValue, windowOpen, settings) {
  const locked = row?.confirmation_locked || row?.cancelled_by_admin;
  const bookedStatus = row?.booking_status;
  const noFoodEnabled = settings[`no_food_enabled_${meal}`] === "true";
  const options = [
    "yes",
    "no",
    ...(noFoodEnabled ? ["no_food"] : []),
    "double",
  ];
  const disabled = locked || !windowOpen;

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
      <div class="option-group ${options.length > 3 ? "option-group--4" : ""}">
        ${options
          .map(
            (opt) => `
          <button class="option-btn ${selectedValue === opt ? "is-selected" : ""}" data-value="${opt}"
            ${disabled ? "disabled" : ""}>${STATUS_LABELS[opt]}</button>
        `,
          )
          .join("")}
      </div>
      ${row?.confirmation_locked ? '<p class="text-soft" style="font-size:12px;margin:0;"><i class="fa-solid fa-lock"></i> Already submitted — locked</p>' : ""}
    </div>
  `;
}

function wireMealCardSelection(container, meal, row, selection, windowOpen) {
  if (row?.confirmation_locked || row?.cancelled_by_admin || !windowOpen)
    return;
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

async function submitConfirmations(container, ctx, date, byMeal, selection) {
  const submitBtn = container.querySelector("#submitConfirmation");
  const changed = MEAL_TYPES.filter((m) => {
    const row = byMeal[m];
    if (row?.confirmation_locked || row?.cancelled_by_admin) return false;
    return selection[m] && selection[m] !== (row?.confirmed_status || null);
  });

  if (!changed.length) {
    toast.info("Select at least one meal option before submitting.");
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
