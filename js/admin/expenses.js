// ============================================================================
// admin/expenses.js — expense CRUD, filterable by category / date / month / year
// ============================================================================
import { supabase, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '../config.js';
import { formatDate, currency, debounce, todayISO } from '../utils.js';
import { renderTable } from '../components/Table.js';
import { openModal, closeModal, confirmDialog } from '../components/Modal.js';
import { toast } from '../components/Toast.js';

export async function renderExpenses(root) {
  root.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <select id="filterCategory"><option value="">All categories</option>${EXPENSE_CATEGORIES.map(c => `<option value="${c}">${EXPENSE_CATEGORY_LABELS[c]}</option>`).join('')}</select>
        <input type="month" id="filterMonth">
        <button class="btn btn-primary btn-sm" id="addExpenseBtn"><i class="fa-solid fa-plus"></i> Add Expense</button>
      </div>
    </div>
    <div id="expensesTable"><div class="skeleton" style="height:220px;border-radius:16px;"></div></div>
  `;

  const state = { category: '', month: '' };

  async function load() {
    let query = supabase.from('expenses').select('*').order('date', { ascending: false });
    if (state.category) query = query.eq('category', state.category);
    if (state.month) {
      const [y, m] = state.month.split('-');
      query = query.gte('date', `${y}-${m}-01`).lte('date', new Date(Number(y), Number(m), 0).toISOString().slice(0, 10));
    }
    const { data, error } = await query;
    if (error) { document.getElementById('expensesTable').innerHTML = `<p class="text-danger">Failed to load expenses.</p>`; return; }

    const total = (data || []).reduce((s, e) => s + Number(e.amount), 0);
    const columns = [
      { key: 'date', label: 'Date', render: r => formatDate(r.date) },
      { key: 'category', label: 'Category', render: r => EXPENSE_CATEGORY_LABELS[r.category] },
      { key: 'amount', label: 'Amount', render: r => currency(r.amount) },
      { key: 'remarks', label: 'Remarks', render: r => r.remarks || '—' },
      { key: 'actions', label: 'Actions', render: r => `
        <div style="display:flex;gap:6px;">
          <button class="icon-btn btn-sm" data-act="edit" data-id="${r.id}" style="width:36px;height:36px;"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn btn-sm" data-act="delete" data-id="${r.id}" style="width:36px;height:36px;"><i class="fa-solid fa-trash text-danger"></i></button>
        </div>` },
    ];
    document.getElementById('expensesTable').innerHTML = `
      <div class="card" style="margin-bottom:12px;"><div class="card__label">Total (filtered)</div><div class="card__value">${currency(total)}</div></div>
      ${renderTable(columns, data, { emptyMessage: 'No expenses recorded' })}
    `;
    document.querySelectorAll('[data-act="edit"]').forEach(b => b.onclick = () => openExpenseModal(data.find(r => r.id == b.dataset.id), load));
    document.querySelectorAll('[data-act="delete"]').forEach(b => b.onclick = () => deleteExpense(b.dataset.id, load));
  }

  document.getElementById('filterCategory').addEventListener('change', e => { state.category = e.target.value; load(); });
  document.getElementById('filterMonth').addEventListener('change', e => { state.month = e.target.value; load(); });
  document.getElementById('addExpenseBtn').addEventListener('click', () => openExpenseModal(null, load));

  load();
}

function openExpenseModal(expense, onSaved) {
  const isEdit = !!expense;
  const body = openModal({
    title: isEdit ? 'Edit Expense' : 'Add Expense',
    bodyHTML: `
      <div class="field"><input type="date" id="expDate" value="${expense?.date || todayISO()}" placeholder=" "><label>Date</label></div>
      <div class="field">
        <select id="expCategory" class="${expense ? 'has-value' : ''}">${EXPENSE_CATEGORIES.map(c => `<option value="${c}" ${expense?.category === c ? 'selected' : ''}>${EXPENSE_CATEGORY_LABELS[c]}</option>`).join('')}</select>
        <label>Category</label>
      </div>
      <div class="field"><input type="number" id="expAmount" value="${expense?.amount || ''}" placeholder=" " min="0" step="0.01"><label>Amount (₹)</label></div>
      <div class="field"><textarea id="expRemarks" placeholder=" ">${expense?.remarks || ''}</textarea><label>Remarks</label></div>
      <button class="btn btn-primary btn-block" id="saveExpense">${isEdit ? 'Save Changes' : 'Add Expense'}</button>
    `
  });

  body.querySelector('#saveExpense').onclick = async () => {
    const payload = {
      date: body.querySelector('#expDate').value,
      category: body.querySelector('#expCategory').value,
      amount: Number(body.querySelector('#expAmount').value),
      remarks: body.querySelector('#expRemarks').value.trim(),
    };
    if (!payload.date || !payload.amount) { toast.error('Date and amount are required'); return; }

    const { error } = isEdit
      ? await supabase.from('expenses').update(payload).eq('id', expense.id)
      : await supabase.from('expenses').insert(payload);

    if (error) { toast.error('Could not save expense'); return; }
    toast.success(isEdit ? 'Expense updated' : 'Expense added');
    closeModal();
    onSaved();
  };
}

async function deleteExpense(id, onDone) {
  const ok = await confirmDialog('Delete this expense record?', { confirmLabel: 'Delete' });
  if (!ok) return;
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) { toast.error('Could not delete'); return; }
  toast.success('Expense deleted');
  onDone();
}
