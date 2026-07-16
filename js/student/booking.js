// ============================================================================
// student/booking.js — "tomorrow" meal booking (Yes / No / Double), plus the
// combined "Mark Food" view that tabs between Today (confirmation.js) and
// Tomorrow (this file).
//
// Same select-then-submit pattern as confirmation.js: tapping an option only
// updates local state; a Submit button sends the batch. Both selecting and
// submitting are gated to the shared booking_open_time–booking_close_time
// window (default 8:30–11:30 PM).
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { tomorrowISO, getSettings, isWithinWindow } from "../utils.js";
import { toast } from "../components/Toast.js";
import { renderConfirmationPanel } from "./confirmation.js";

export async function renderMarkFood(root, ctx) {
  root.innerHTML = `
    <div class="chip-row">
      <button class="chip is-active" data-tab="today">Today's Confirmation</button>
      <button class="chip" data-tab="tomorrow">Tomorrow's Booking</button>
    </div>
    <div id="markFoodPanel"></div>
  `;
  const panel = root.querySelector("#markFoodPanel");
  const chips = [...root.querySelectorAll(".chip")];

  async function showTab(tab) {
    chips.forEach((c) =>
      c.classList.toggle("is-active", c.dataset.tab === tab),
    );
    panel.innerHTML = `<div class="skeleton" style="height:100px;border-radius:16px;"></div>`;
    if (tab === "today") await renderConfirmationPanel(panel, ctx);
    else await renderBookingPanel(panel, ctx);
  }

  chips.forEach((chip) =>
    chip.addEventListener("click", () => showTab(chip.dataset.tab)),
  );
  showTab("today");
}

async function renderBookingPanel(container, ctx) {
  const tomorrow = tomorrowISO();
  const settings = await getSettings();
  const windowOpen = isWithinWindow(
    settings.booking_open_time,
    settings.booking_close_time,
  );

  const { data: rows, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("student_id", ctx.profile.id)
    .eq("date", tomorrow);

  if (error) {
    container.innerHTML = `<p class="text-danger">Could not load tomorrow's booking.</p>`;
    return;
  }

  const byMeal = {};
  MEAL_TYPES.forEach((m) => {
    byMeal[m] = rows.find((r) => r.meal_type === m) || null;
  });

  const selection = {};
  MEAL_TYPES.forEach((m) => {
    selection[m] = byMeal[m]?.booking_status || null;
  });

  container.innerHTML = `
    <div class="deadline-banner ${windowOpen ? "" : "is-locked"}">
      <i class="fa-solid ${windowOpen ? "fa-clock" : "fa-lock"}"></i>
      ${
        windowOpen
          ? `Booking window open until ${formatWindowLabel(settings.booking_close_time)} tonight.`
          : `Booking is only open ${formatWindowLabel(settings.booking_open_time)}–${formatWindowLabel(settings.booking_close_time)}.`
      }
    </div>
    ${MEAL_TYPES.map((meal) => bookingCardHTML(meal, byMeal[meal], selection[meal], windowOpen)).join("")}
    ${windowOpen ? `<button class="btn btn-primary btn-block" id="submitBooking"><i class="fa-solid fa-check"></i> Submit Booking</button>` : ""}
  `;

  MEAL_TYPES.forEach((meal) =>
    wireBookingCardSelection(
      container,
      meal,
      byMeal[meal],
      selection,
      windowOpen,
    ),
  );

  const submitBtn = container.querySelector("#submitBooking");
  if (submitBtn) {
    submitBtn.addEventListener("click", () =>
      submitBookings(container, ctx, tomorrow, byMeal, selection),
    );
  }
}

function formatWindowLabel(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function bookingCardHTML(meal, row, selectedValue, windowOpen) {
  const locked = row?.booking_locked || row?.cancelled_by_admin;
  const disabled = locked || !windowOpen;
  return `
    <div class="card meal-card" data-meal="${meal}">
      <div class="meal-card__head">
        <span class="meal-name">${MEAL_LABELS[meal]}</span>
        ${row?.cancelled_by_admin ? '<span class="badge badge-no">Cancelled by admin</span>' : ""}
      </div>
      <div class="option-group">
        ${["yes", "no", "double"]
          .map(
            (opt) => `
          <button class="option-btn ${selectedValue === opt ? "is-selected" : ""}" data-value="${opt}"
            ${disabled ? "disabled" : ""}>${STATUS_LABELS[opt]}</button>
        `,
          )
          .join("")}
      </div>
      ${row?.booking_locked ? '<p class="text-soft" style="font-size:12px;margin:0;"><i class="fa-solid fa-lock"></i> Already submitted — locked</p>' : ""}
    </div>
  `;
}

function wireBookingCardSelection(container, meal, row, selection, windowOpen) {
  if (row?.booking_locked || row?.cancelled_by_admin || !windowOpen) return;
  const card = container.querySelector(`[data-meal="${meal}"]`);
  if (!card) return;
  card.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      card
        .querySelectorAll(".option-btn")
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selection[meal] = btn.dataset.value;
    });
  });
}

async function submitBookings(container, ctx, date, byMeal, selection) {
  const submitBtn = container.querySelector("#submitBooking");
  const changed = MEAL_TYPES.filter((m) => {
    const row = byMeal[m];
    if (row?.booking_locked || row?.cancelled_by_admin) return false;
    return selection[m] && selection[m] !== (row?.booking_status || null);
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
    booking_status: selection[meal],
    booked_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("bookings")
    .upsert(payload, { onConflict: "student_id,date,meal_type" });

  if (error) {
    toast.error("Could not save your booking. Please try again.");
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Submit Booking';
    return;
  }

  toast.success("Booking submitted for tomorrow");
  await renderBookingPanel(container, ctx);
}
