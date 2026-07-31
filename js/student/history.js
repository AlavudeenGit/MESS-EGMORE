// ============================================================================
// student/history.js — own booking/confirmation history, filterable + exportable.
// One row per DATE, with Breakfast/Lunch/Dinner status side-by-side.
// ============================================================================
import { supabase, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import { formatDate, exportToExcel, exportToPDF } from "../utils.js";
import { renderTable } from "../components/Table.js";

export async function renderHistory(root, ctx) {
  root.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <input type="month" id="filterMonth">
        <button class="btn btn-secondary btn-sm" id="clearFilters">Clear</button>
      </div>
    </div>
    <div class="report-toolbar">
      <button class="btn btn-secondary btn-sm" id="exportExcel"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn btn-secondary btn-sm" id="exportPdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      <button class="btn btn-secondary btn-sm" id="printBtn"><i class="fa-solid fa-print"></i> Print</button>
    </div>
    <div id="historyTable"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
  `;

  const state = { month: "" };
  let lastRows = [];

  async function load() {
    let query = supabase
      .from("bookings")
      .select("date, meal_type, confirmed_status, booking_status")
      .eq("student_id", ctx.profile.id)
      .order("date", { ascending: false });

    if (state.month) {
      const [y, m] = state.month.split("-");
      query = query
        .gte("date", `${y}-${m}-01`)
        .lte(
          "date",
          new Date(Number(y), Number(m), 0).toISOString().slice(0, 10),
        );
    }

    const { data: bookingRows, error } = await query;
    if (error) {
      document.getElementById("historyTable").innerHTML =
        `<p class="text-danger">Failed to load history.</p>`;
      return;
    }

    // group booking rows by date -> { breakfast, lunch, dinner }
    const byDate = {};
    (bookingRows || []).forEach((r) => {
      byDate[r.date] = byDate[r.date] || {};
      byDate[r.date][r.meal_type] =
        r.confirmed_status || r.booking_status || null;
    });

    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

    lastRows = dates.map((d) => ({
      date: d,
      breakfast: byDate[d].breakfast || null,
      lunch: byDate[d].lunch || null,
      dinner: byDate[d].dinner || null,
    }));

    renderTableView(lastRows);
  }

  function renderTableView(rows) {
    const columns = [
      { key: "date", label: "Date", render: (r) => formatDate(r.date) },
      {
        key: "breakfast",
        label: "Breakfast",
        render: (r) => statusBadge(r.breakfast),
      },
      { key: "lunch", label: "Lunch", render: (r) => statusBadge(r.lunch) },
      { key: "dinner", label: "Dinner", render: (r) => statusBadge(r.dinner) },
    ];
    document.getElementById("historyTable").innerHTML = renderTable(
      columns,
      rows,
      { emptyMessage: "No history for this filter" },
    );
  }

  function statusBadge(status) {
    if (!status) return "—";
    return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  document.getElementById("filterMonth").addEventListener("change", (e) => {
    state.month = e.target.value;
    load();
  });
  document.getElementById("clearFilters").addEventListener("click", () => {
    state.month = "";
    document.getElementById("filterMonth").value = "";
    load();
  });

  document.getElementById("exportExcel").addEventListener("click", () => {
    exportToExcel(
      lastRows.map((r) => ({
        Date: formatDate(r.date),
        Breakfast: r.breakfast
          ? STATUS_LABELS[r.breakfast] || r.breakfast
          : "—",
        Lunch: r.lunch ? STATUS_LABELS[r.lunch] || r.lunch : "—",
        Dinner: r.dinner ? STATUS_LABELS[r.dinner] || r.dinner : "—",
      })),
      `my-history-${ctx.profile.name.replace(/\s+/g, "_")}`,
    );
  });
  document.getElementById("exportPdf").addEventListener("click", () => {
    exportToPDF(
      [
        { key: "Date", label: "Date" },
        { key: "Breakfast", label: "Breakfast" },
        { key: "Lunch", label: "Lunch" },
        { key: "Dinner", label: "Dinner" },
      ],
      lastRows.map((r) => ({
        Date: formatDate(r.date),
        Breakfast: r.breakfast
          ? STATUS_LABELS[r.breakfast] || r.breakfast
          : "—",
        Lunch: r.lunch ? STATUS_LABELS[r.lunch] || r.lunch : "—",
        Dinner: r.dinner ? STATUS_LABELS[r.dinner] || r.dinner : "—",
      })),
      "My Meal History",
      "my-history",
    );
  });
  document
    .getElementById("printBtn")
    .addEventListener("click", () => window.print());

  load();
}
