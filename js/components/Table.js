// ============================================================================
// Table.js — generic data table renderer.
// Renders as a real <table> (card-per-row on mobile is handled purely in
// CSS via td::before { content: attr(data-label) }, see .data-table rules).
// ============================================================================

/**
 * columns: [{ key, label, render?: (row) => string }]
 * rows: array of plain objects
 * opts: { emptyMessage }
 */
export function renderTable(columns, rows, opts = {}) {
  if (!rows || !rows.length) {
    return `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>${opts.emptyMessage || "No records found"}</p></div>`;
  }
  const thead = `<thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) => `
    <tr>${columns
      .map(
        (c) => `
      <td data-label="${c.label}">${c.render ? c.render(row) : (row[c.key] ?? "—")}</td>
    `,
      )
      .join("")}</tr>
  `,
    )
    .join("")}</tbody>`;
  return `<div class="table-wrap"><table class="data-table">${thead}${tbody}</table></div>`;
}

/** injects the table into a container element by id or Element */
export function mountTable(target, columns, rows, opts = {}) {
  const el =
    typeof target === "string" ? document.getElementById(target) : target;
  if (el) el.innerHTML = renderTable(columns, rows, opts);
}
