// ============================================================================
// admin/meals.js — Meal Entries page.
//
// Layout:
//   1. Six summary cards: Today's Meals (B/L/D totals) + Tomorrow's
//      Bookings (B/L/D totals).
//   2. "Today's Meal Marking" table — TODAY's booking status per student
//      (what was booked yesterday evening for today). Editable via the
//      override modal, but ONLY today's date — the DB trigger itself
//      refuses any admin write to another date for an individual student.
//   3. "Tomorrow Booking" table — TOMORROW's booking status per student,
//      read-only (no per-student edit; only the bulk-cancel action below
//      is allowed to touch tomorrow's date).
//
// Both tables only list students with at least one meal booked Yes/Double
// for that respective day — a student who booked No everywhere (or
// nothing at all) has nothing for the kitchen to act on, so they're
// hidden rather than cluttering the list.
//
// Both tables render in "flat" mode (see Table.js / css/main.css
// .data-table--flat) so mobile shows the same real scrollable table as
// desktop, not the stacked-card view used elsewhere in the app.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { todayISO, tomorrowISO, formatDate, debounce } from "../utils.js";
import { renderTable } from "../components/Table.js";
import { statCard } from "../components/Card.js";
import { openModal, closeModal, confirmDialog } from "../components/Modal.js";
import { toast } from "../components/Toast.js";

export async function renderMeals(root) {
  const today = todayISO();
  const tomorrow = tomorrowISO();

  root.innerHTML = `
    <div id="mealsSummary" class="card-grid"></div>



    <div class="card">
      <h3>Today's Meal Marking <span class="badge badge-locked">${formatDate(today)}</span></h3>
      <p class="text-soft" style="font-size:13px;">Overrides only apply to today. Only students with at least one meal booked Yes/Double are listed.</p>
      <div class="filter-bar">
        <input type="text" id="filterNameToday" placeholder="Search name or room…">
      </div>
      <div id="todayTable"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
    </div>

    <div class="card">
      <h3>Tomorrow Booking <span class="badge badge-locked">${formatDate(tomorrow)}</span></h3>
      <p class="text-soft" style="font-size:13px;">Read-only — what students have booked so far tonight for tomorrow. Use Bulk Cancel above to change a meal for everyone at once.</p>
      <div class="filter-bar">
        <input type="text" id="filterNameTomorrow" placeholder="Search name or room…">
      </div>
      <div id="tomorrowTable"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
    </div>
    
        <div class="card">
      <h3>Bulk Cancel a Meal</h3>
      <p class="text-soft" style="font-size:13px;">Cancelling sets every student's booking for that meal to "No" and locks it.</p>
      <div class="filter-bar">
        <select id="cancelDay"><option value="${today}">Today</option><option value="${tomorrow}">Tomorrow</option></select>
        <select id="cancelMeal">${MEAL_TYPES.map((m) => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join("")}</select>
        <button class="btn btn-danger btn-sm" id="cancelMealBtn"><i class="fa-solid fa-ban"></i> Cancel Meal</button>
      </div>
    </div>
  `;

  const state = { searchToday: "", searchTomorrow: "" };
  let todayRowsCache = [];

  async function loadSummary() {
    const [{ data: todayBookings }, { data: tomorrowBookings }] =
      await Promise.all([
        supabase
          .from("bookings")
          .select("meal_type, booking_status")
          .eq("date", today),
        supabase
          .from("bookings")
          .select("meal_type, booking_status")
          .eq("date", tomorrow),
      ]);
    const todayCounts = countByMeal(todayBookings);
    const tomorrowCounts = countByMeal(tomorrowBookings);

    document.getElementById("mealsSummary").innerHTML = `
      ${statCard({ label: "Today's Breakfast", value: todayCounts.breakfast, icon: "fa-mug-hot" })}
      ${statCard({ label: "Today's Lunch", value: todayCounts.lunch, icon: "fa-bowl-food" })}
      ${statCard({ label: "Today's Dinner", value: todayCounts.dinner, icon: "fa-utensils" })}
      ${statCard({ label: "Tomorrow's Breakfast", value: tomorrowCounts.breakfast, icon: "fa-mug-hot" })}
      ${statCard({ label: "Tomorrow's Lunch", value: tomorrowCounts.lunch, icon: "fa-bowl-food" })}
      ${statCard({ label: "Tomorrow's Dinner", value: tomorrowCounts.dinner, icon: "fa-utensils" })}
    `;
  }

  function countByMeal(rows) {
    const out = { breakfast: 0, lunch: 0, dinner: 0 };
    (rows || []).forEach((r) => {
      out[r.meal_type] += bookingCountValue(r.booking_status);
    });
    return out;
  }

  function bookingCountValue(status) {
    if (status === "double") return 2;
    if (status === "yes") return 1;
    return 0;
  }

  async function loadTodayTable() {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, student_id, meal_type, booking_status, confirmed_status, cancelled_by_admin, students(name, room_number)",
      )
      .eq("date", today);
    if (error) {
      document.getElementById("todayTable").innerHTML =
        `<p class="text-danger">Failed to load entries.</p>`;
      return;
    }

    let rows = groupByStudent(data);
    rows = rows.filter((r) =>
      MEAL_TYPES.some((m) =>
        ["yes", "double"].includes(r.meals[m]?.booking_status),
      ),
    );
    if (state.searchToday) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(state.searchToday) ||
          r.room.toLowerCase().includes(state.searchToday),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    todayRowsCache = rows;

    const columns = [
      { key: "name", label: "Student Name" },
      { key: "room", label: "Room No" },
      ...MEAL_TYPES.map((meal) => ({
        key: meal,
        label: MEAL_LABELS[meal],
        render: (r) => bookingBadgeHTML(r.meals[meal]?.booking_status),
      })),
      {
        key: "actions",
        label: "Actions",
        render: (r) =>
          `<button class="btn btn-secondary btn-sm" data-act="edit" data-student="${r.student_id}">Edit</button>`,
      },
    ];
    document.getElementById("todayTable").innerHTML = renderTable(
      columns,
      rows,
      {
        emptyMessage: "No students have booked any meal for today yet",
        flat: true,
      },
    );
    document.querySelectorAll('[data-act="edit"]').forEach(
      (b) =>
        (b.onclick = () =>
          openOverrideModal(
            todayRowsCache.find((r) => r.student_id === b.dataset.student),
            today,
            () => {
              loadTodayTable();
              loadSummary();
            },
          )),
    );
  }

  async function loadTomorrowTable() {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, student_id, meal_type, booking_status, students(name, room_number)",
      )
      .eq("date", tomorrow);
    if (error) {
      document.getElementById("tomorrowTable").innerHTML =
        `<p class="text-danger">Failed to load entries.</p>`;
      return;
    }

    let rows = groupByStudent(data);
    rows = rows.filter((r) =>
      MEAL_TYPES.some((m) =>
        ["yes", "double"].includes(r.meals[m]?.booking_status),
      ),
    );
    if (state.searchTomorrow) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(state.searchTomorrow) ||
          r.room.toLowerCase().includes(state.searchTomorrow),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const columns = [
      { key: "name", label: "Student Name" },
      { key: "room", label: "Room No" },
      ...MEAL_TYPES.map((meal) => ({
        key: meal,
        label: MEAL_LABELS[meal],
        render: (r) => bookingBadgeHTML(r.meals[meal]?.booking_status),
      })),
    ];
    document.getElementById("tomorrowTable").innerHTML = renderTable(
      columns,
      rows,
      {
        emptyMessage: "No students have booked anything for tomorrow yet",
        flat: true,
      },
    );
  }

  function groupByStudent(data) {
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
    return Object.values(byStudent);
  }

  function bookingBadgeHTML(status) {
    if (!status)
      return '<span class="text-soft" style="font-size:12px;">—</span>';
    return `<span class="badge badge-${status}">${STATUS_LABELS[status]}</span>`;
  }

  document.getElementById("filterNameToday").addEventListener(
    "input",
    debounce((e) => {
      state.searchToday = e.target.value.toLowerCase();
      loadTodayTable();
    }, 250),
  );
  document.getElementById("filterNameTomorrow").addEventListener(
    "input",
    debounce((e) => {
      state.searchTomorrow = e.target.value.toLowerCase();
      loadTomorrowTable();
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
      loadSummary();
      loadTodayTable();
      loadTomorrowTable();
    });

  loadSummary();
  loadTodayTable();
  loadTomorrowTable();
}

function openOverrideModal(studentRow, date, onSaved) {
  const bookingOptions = ["yes", "no", "double"];

  const sectionsHTML = MEAL_TYPES.map((meal) => {
    const row = studentRow.meals[meal];
    const confirmedLabel = row?.confirmed_status
      ? STATUS_LABELS[row.confirmed_status]
      : "Not yet confirmed by student";
    return `
      <div style="margin-bottom:20px;" data-meal-section="${meal}">
        <h4>${MEAL_LABELS[meal]}</h4>
        <p class="text-soft" style="font-size:12px;margin:0 0 6px;">Booking (set yesterday for today)</p>
        <div class="option-group">${bookingOptions.map((o) => `<button class="option-btn ${row?.booking_status === o ? "is-selected" : ""}" data-meal="${meal}" data-value="${o}">${STATUS_LABELS[o]}</button>`).join("")}</div>
        <p class="text-soft" style="font-size:12px;margin:10px 0 0;"><i class="fa-solid fa-lock"></i> Confirmed: ${confirmedLabel} — set by the student, not editable here</p>
      </div>
      <hr class="divider">
    `;
  }).join("");

  const body = openModal({
    title: `Override Booking — ${studentRow.name} (Today)`,
    bodyHTML: `${sectionsHTML}<button class="btn btn-primary btn-block" id="saveOverride">Save Changes</button>`,
  });

  const newValues = {};
  MEAL_TYPES.forEach((meal) => {
    newValues[meal] = studentRow.meals[meal]?.booking_status || null;
  });

  body.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      const { meal, value } = btn.dataset;
      body
        .querySelectorAll(`[data-meal="${meal}"]`)
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      newValues[meal] = value;
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
      booking_status: newValues[meal],
    }));

    const { error } = await supabase
      .from("bookings")
      .upsert(payload, { onConflict: "student_id,date,meal_type" });
    if (error) {
      toast.error("Could not save overrides");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
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
