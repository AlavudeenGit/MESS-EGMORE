// ============================================================================
// admin/menu.js — edit the weekly recurring menu (one row per day of week)
// ============================================================================
import { supabase, DAY_NAMES } from '../config.js';
import { toast } from '../components/Toast.js';

export async function renderAdminMenu(root) {
  const { data: rows, error } = await supabase.from('menu').select('*').order('day_of_week');
  if (error || !rows) { root.innerHTML = `<p class="text-danger">Could not load the menu.</p>`; return; }

  root.innerHTML = `
    <div class="menu-week-list">
      ${rows.map(r => `
        <div class="card" data-day="${r.day_of_week}">
          <h4>${DAY_NAMES[r.day_of_week - 1]}</h4>
          <div class="field"><input class="menu-input" data-field="breakfast_text" value="${r.breakfast_text || ''}" placeholder=" "><label>Breakfast</label></div>
          <div class="field"><input class="menu-input" data-field="lunch_text" value="${r.lunch_text || ''}" placeholder=" "><label>Lunch</label></div>
          <div class="field"><input class="menu-input" data-field="dinner_text" value="${r.dinner_text || ''}" placeholder=" "><label>Dinner</label></div>
          <button class="btn btn-primary btn-sm" data-act="save">Save ${DAY_NAMES[r.day_of_week - 1]}</button>
        </div>
      `).join('')}
    </div>
  `;

  root.querySelectorAll('[data-day]').forEach(card => {
    card.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const day = card.dataset.day;
      const payload = {};
      card.querySelectorAll('.menu-input').forEach(input => { payload[input.dataset.field] = input.value.trim(); });
      const { error } = await supabase.from('menu').update(payload).eq('day_of_week', day);
      if (error) { toast.error('Could not save menu'); return; }
      toast.success(`${DAY_NAMES[day - 1]} menu saved`);
    });
  });
}
