// ============================================================================
// admin/meals.js — one row per student (Breakfast/Lunch/Dinner side by
// side), override any meal, plus bulk-cancel a meal for Today or Tomorrow.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { todayISO, tomorrowISO, formatDate, debounce } from "../utils.js";
import { renderTable } from "../components/Table.js";
import { openModal, closeModal, confirmDialog } from "../components/Modal.js";
import { toast } from "../components/Toast.js";

export async function renderMeals(root) {
  const today = todayISO();
  root.innerHTML = `
    <div class="card">
      <h3>Bulk Cancel a Meal</h3>
      <p class="text-soft" style="font-size:13px;">Cancelling sets every student's booking for that meal to "No" and locks it.</p>
      <div class="filter-bar">
        <select id="cancelDay"><option value="${today}">Today</option><option value="${tomorrowISO()}">Tomorrow</option></select>
        <select id="cancelMeal">${MEAL_TYPES.map((m) => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join("")}</select>
        <button class="btn btn-danger btn-sm" id="cancelMealBtn"><i class="fa-solid fa-ban"></i> Cancel Meal</button>
      </div>
    </div>

    <div class="card">
      <div class="filter-bar">
        <input type="date" id="filterDate" value="${today}">
        <input type="text" id="filterName" placeholder="Search name or room…">
      </div>
    </div>
    <div id="mealsTable"><div class="skeleton" style="height:220px;border-radius:16px;"></div></div>
  `;

  const state = { date: today, search: "" };

  async function load() {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, student_id, meal_type, booking_status, confirmed_status, cancelled_by_admin, students(name, room_number)",
      )
      .eq("date", state.date);
    if (error) {
      document.getElementById("mealsTable").innerHTML =
        `<p class="text-danger">Failed to load entries.</p>`;
      return;
    }

    // consolidate: group the (up to) 3 meal rows per student into ONE row
    const byStudent = {};
    (data || []).forEach((r) => {
      const key = r.student_id;
      byStudent[key] = byStudent[key] || {
        student_id: key,
        name: r.students?.name || "—",
        room: r.students?.room_number || "—",
        meals: {},
      };
      byStudent[key].meals[r.meal_type] = r;
    });

    let rows = Object.values(byStudent);
    if (state.search) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(state.search) ||
          r.room.toLowerCase().includes(state.search),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const columns = [
      { key: "name", label: "Name", render: (r) => r.name },
      { key: "room", label: "Room", render: (r) => r.room },
      ...MEAL_TYPES.map((meal) => ({
        key: meal,
        label: MEAL_LABELS[meal],
        render: (r) => mealCellHTML(r.meals[meal]),
      })),
      {
        key: "actions",
        label: "Actions",
        render: (r) =>
          `<button class="btn btn-secondary btn-sm" data-act="edit" data-student="${r.student_id}">Edit</button>`,
      },
    ];
    document.getElementById("mealsTable").innerHTML = renderTable(
      columns,
      rows,
      { emptyMessage: "No bookings for this date" },
    );
    document.querySelectorAll('[data-act="edit"]').forEach(
      (b) =>
        (b.onclick = () =>
          openOverrideModal(
            rows.find((r) => r.student_id === b.dataset.student),
            state.date,
            load,
          )),
    );
  }

  function mealCellHTML(row) {
    if (!row) return '<span class="text-soft" style="font-size:12px;">—</span>';
    const booked = row.booking_status
      ? `<span class="badge badge-${row.booking_status}" style="font-size:10px;">B: ${STATUS_LABELS[row.booking_status]}</span>`
      : "";
    const confirmed = row.confirmed_status
      ? `<span class="badge badge-${row.confirmed_status}" style="font-size:10px;">C: ${STATUS_LABELS[row.confirmed_status]}</span>`
      : "";
    return `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">${booked}${confirmed}${!booked && !confirmed ? '<span class="text-soft" style="font-size:12px;">—</span>' : ""}</div>`;
  }

  document.getElementById("filterDate").addEventListener("change", (e) => {
    state.date = e.target.value;
    load();
  });
  document.getElementById("filterName").addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value.toLowerCase();
      load();
    }, 250),
  );

  document
    .getElementById("cancelMealBtn")
    .addEventListener("click", async () => {
      const date = document.getElementById("cancelDay").value;
      const meal = document.getElementById("cancelMeal").value;
      const ok = await confirmDialog(
        `Cancel ${MEAL_LABELS[meal]} for ${formatDate(date)}? All students' bookings for this meal become "No" and read-only.`,
        { confirmLabel: "Cancel Meal" },
      );
      if (!ok) return;

      const { data: activeStudents } = await supabase
        .from("students")
        .select("id")
        .eq("status", "active");
      const rows = (activeStudents || []).map((s) => ({
        student_id: s.id,
        date,
        meal_type: meal,
        booking_status: "no",
        booking_locked: true,
        confirmed_status: "no",
        confirmation_locked: true,
        confirmed_at: new Date().toISOString(),
        cancelled_by_admin: true,
      }));
      const { error } = await supabase
        .from("bookings")
        .upsert(rows, { onConflict: "student_id,date,meal_type" });
      if (error) {
        toast.error("Could not cancel meal");
        return;
      }
      toast.success(`${MEAL_LABELS[meal]} cancelled for ${formatDate(date)}`);
      load();
    });

  load();
}

function openOverrideModal(studentRow, date, onSaved) {
  const bookingOptions = ["yes", "no", "double"];
  const confirmOptions = ["yes", "no", "no_food", "double"];

  const sectionsHTML = MEAL_TYPES.map((meal) => {
    const row = studentRow.meals[meal];
    return `
      <div style="margin-bottom:20px;" data-meal-section="${meal}">
        <h4>${MEAL_LABELS[meal]}</h4>
        <p class="text-soft" style="font-size:12px;margin:0 0 6px;">Booking</p>
        <div class="option-group">${bookingOptions.map((o) => `<button class="option-btn ${row?.booking_status === o ? "is-selected" : ""}" data-meal="${meal}" data-group="booking" data-value="${o}">${STATUS_LABELS[o]}</button>`).join("")}</div>
        <p class="text-soft" style="font-size:12px;margin:10px 0 6px;">Confirmed</p>
        <div class="option-group option-group--4">${confirmOptions.map((o) => `<button class="option-btn ${row?.confirmed_status === o ? "is-selected" : ""}" data-meal="${meal}" data-group="confirmed" data-value="${o}">${STATUS_LABELS[o]}</button>`).join("")}</div>
      </div>
      <hr class="divider">
    `;
  }).join("");

  const body = openModal({
    title: `Override — ${studentRow.name}`,
    bodyHTML: `${sectionsHTML}<button class="btn btn-primary btn-block" id="saveOverride">Save All Changes</button>`,
  });

  const newValues = {};
  MEAL_TYPES.forEach((meal) => {
    newValues[meal] = {
      booking: studentRow.meals[meal]?.booking_status || null,
      confirmed: studentRow.meals[meal]?.confirmed_status || null,
    };
  });

  body.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      const { meal, group, value } = btn.dataset;
      body
        .querySelectorAll(`[data-meal="${meal}"][data-group="${group}"]`)
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      newValues[meal][group] = value;
    };
  });

  body.querySelector("#saveOverride").onclick = async () => {
    const saveBtn = body.querySelector("#saveOverride");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const payload = MEAL_TYPES.map((meal) => ({
      student_id: studentRow.student_id,
      date,
      meal_type: meal,
      booking_status: newValues[meal].booking,
      confirmed_status: newValues[meal].confirmed,
    }));

    const { error } = await supabase
      .from("bookings")
      .upsert(payload, { onConflict: "student_id,date,meal_type" });
    if (error) {
      toast.error("Could not save overrides");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save All Changes";
      return;
    }

    await supabase.rpc("recompute_daily_fine", {
      p_student_id: studentRow.student_id,
      p_date: date,
    });
    toast.success("Overrides saved");
    closeModal();
    onSaved();
  };
}
