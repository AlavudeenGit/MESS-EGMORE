// ============================================================================
// admin/payments.js — monthly mess amount + payment status per student.
// Also surfaces each student's Double Meal count for the month as a
// reference-only estimate (count x settings.meal_rate_*) — this is NEVER
// auto-added to mess_amount; the admin decides what to actually charge
// and types it into the Mess Amount field themselves.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS } from "../config.js";
import { currency, debounce, todayISO, getSettings } from "../utils.js";
import { renderTable } from "../components/Table.js";
import { toast } from "../components/Toast.js";

export async function renderPayments(root) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  root.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <input type="text" id="searchName" placeholder="Search name or room…">
        <input type="month" id="filterMonth" value="${defaultMonth}">
        <select id="filterActive"><option value="">All students</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <select id="filterPaid"><option value="">Paid / Unpaid</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></select>
        <select id="filterAte"><option value="">Ate this month?</option><option value="yes">Ate this month</option><option value="no">Did not eat</option></select>
      </div>
    </div>
    <div id="paymentsTable"><div class="skeleton" style="height:260px;border-radius:16px;"></div></div>
  `;

  const state = {
    search: "",
    month: defaultMonth,
    active: "",
    paid: "",
    ate: "",
  };
  const settings = await getSettings();
  const rates = {
    breakfast: Number(settings.meal_rate_breakfast) || 0,
    lunch: Number(settings.meal_rate_lunch) || 0,
    dinner: Number(settings.meal_rate_dinner) || 0,
  };

  async function load() {
    const monthStart = `${state.month}-01`;
    const monthEnd = new Date(
      Number(state.month.split("-")[0]),
      Number(state.month.split("-")[1]),
      0,
    )
      .toISOString()
      .slice(0, 10);

    let studentQuery = supabase
      .from("students")
      .select("*")
      .neq("status", "pending");
    if (state.active) studentQuery = studentQuery.eq("status", state.active);
    const { data: students, error: sErr } = await studentQuery;
    if (sErr) {
      document.getElementById("paymentsTable").innerHTML =
        `<p class="text-danger">Failed to load students.</p>`;
      return;
    }

    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("month_year", monthStart);
    const { data: eaten } = await supabase
      .from("bookings")
      .select("student_id")
      .gte("date", monthStart)
      .lte("date", monthEnd)
      .in("confirmed_status", ["yes", "double"]);
    const ateSet = new Set((eaten || []).map((r) => r.student_id));

    // double-meal counts, per student, per meal type, for the month
    const { data: doubles } = await supabase
      .from("bookings")
      .select("student_id, meal_type")
      .gte("date", monthStart)
      .lte("date", monthEnd)
      .eq("confirmed_status", "double");
    const doubleCounts = {}; // student_id -> { breakfast: n, lunch: n, dinner: n }
    (doubles || []).forEach((r) => {
      doubleCounts[r.student_id] = doubleCounts[r.student_id] || {
        breakfast: 0,
        lunch: 0,
        dinner: 0,
      };
      doubleCounts[r.student_id][r.meal_type]++;
    });

    let rows = students.map((s) => {
      const pay = (payments || []).find((p) => p.student_id === s.id);
      const dCounts = doubleCounts[s.id] || {
        breakfast: 0,
        lunch: 0,
        dinner: 0,
      };
      const estCost =
        dCounts.breakfast * rates.breakfast +
        dCounts.lunch * rates.lunch +
        dCounts.dinner * rates.dinner;
      return {
        student: s,
        payment: pay || { mess_amount: 0, paid_amount: 0, status: "unpaid" },
        ate: ateSet.has(s.id),
        doubleCounts: dCounts,
        doubleTotal: dCounts.breakfast + dCounts.lunch + dCounts.dinner,
        estCost,
      };
    });

    if (state.search)
      rows = rows.filter(
        (r) =>
          r.student.name.toLowerCase().includes(state.search) ||
          r.student.room_number.toLowerCase().includes(state.search),
      );
    if (state.paid) rows = rows.filter((r) => r.payment.status === state.paid);
    if (state.ate === "yes") rows = rows.filter((r) => r.ate);
    if (state.ate === "no") rows = rows.filter((r) => !r.ate);

    renderRows(rows, monthStart);
  }

  function renderRows(rows, monthStart) {
    const columns = [
      { key: "name", label: "Name", render: (r) => r.student.name },
      { key: "room", label: "Room", render: (r) => r.student.room_number },
      { key: "mobile", label: "Mobile", render: (r) => r.student.mobile },
      {
        key: "ate",
        label: "Ate?",
        render: (r) =>
          r.ate
            ? '<span class="badge badge-yes">Yes</span>'
            : '<span class="badge badge-no">No</span>',
      },
      {
        key: "double",
        label: "Double Meals",
        render: (r) =>
          r.doubleTotal === 0
            ? "—"
            : `<span title="Breakfast ${r.doubleCounts.breakfast} · Lunch ${r.doubleCounts.lunch} · Dinner ${r.doubleCounts.dinner}" class="badge badge-double">${r.doubleTotal}×</span>`,
      },
      {
        key: "estCost",
        label: "Est. Double Cost",
        render: (r) =>
          r.estCost > 0
            ? `<span class="badge badge-locked" title="Reference only — not added automatically">${currency(r.estCost)}</span>`
            : "—",
      },
      {
        key: "amount",
        label: "Mess Amount",
        render: (r) =>
          `<input type="number" class="mono" style="width:100px;min-height:36px;border:1px solid var(--color-border);border-radius:8px;padding:0 8px;" data-field="amount" data-id="${r.student.id}" value="${r.payment.mess_amount || ""}">`,
      },
      {
        key: "paid",
        label: "Paid Amount",
        render: (r) =>
          `<input type="number" class="mono" style="width:100px;min-height:36px;border:1px solid var(--color-border);border-radius:8px;padding:0 8px;" data-field="paid" data-id="${r.student.id}" value="${r.payment.paid_amount || ""}">`,
      },
      {
        key: "status",
        label: "Status",
        render: (r) =>
          `<span class="badge ${r.payment.status === "paid" ? "badge-yes" : r.payment.status === "partial" ? "badge-pending" : "badge-no"}">${r.payment.status}</span>`,
      },
      {
        key: "save",
        label: "",
        render: (r) =>
          `<button class="btn btn-primary btn-sm" data-act="save" data-id="${r.student.id}">Save</button>`,
      },
    ];
    document.getElementById("paymentsTable").innerHTML = `
      <p class="text-soft" style="font-size:12px;margin:0 0 8px;"><i class="fa-solid fa-circle-info"></i> "Est. Double Cost" is a reference figure (double-meal count × rate from Settings) — it is not added to Mess Amount automatically. Set per-meal rates under Settings if this shows ₹0.</p>
      ${renderTable(columns, rows, { emptyMessage: "No students found" })}
    `;

    document.querySelectorAll('[data-act="save"]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const amount =
          Number(
            document.querySelector(`[data-field="amount"][data-id="${id}"]`)
              .value,
          ) || 0;
        const paid =
          Number(
            document.querySelector(`[data-field="paid"][data-id="${id}"]`)
              .value,
          ) || 0;
        const status =
          paid <= 0
            ? "unpaid"
            : paid >= amount && amount > 0
              ? "paid"
              : "partial";

        const { error } = await supabase.from("payments").upsert(
          {
            student_id: id,
            month_year: monthStart,
            mess_amount: amount,
            paid_amount: paid,
            status,
            payment_date: paid > 0 ? todayISO() : null,
          },
          { onConflict: "student_id,month_year" },
        );

        if (error) {
          toast.error("Could not save payment");
          return;
        }
        toast.success("Payment saved");
        load();
      };
    });
  }

  document.getElementById("searchName").addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value.toLowerCase();
      load();
    }, 250),
  );
  document.getElementById("filterMonth").addEventListener("change", (e) => {
    state.month = e.target.value;
    load();
  });
  document.getElementById("filterActive").addEventListener("change", (e) => {
    state.active = e.target.value;
    load();
  });
  document.getElementById("filterPaid").addEventListener("change", (e) => {
    state.paid = e.target.value;
    load();
  });
  document.getElementById("filterAte").addEventListener("change", (e) => {
    state.ate = e.target.value;
    load();
  });

  load();
}
