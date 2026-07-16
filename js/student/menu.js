// ============================================================================
// student/menu.js — read-only weekly menu (admin updates it via admin/menu.js)
// ============================================================================
import { supabase, DAY_NAMES } from '../config.js';
import { isoDayOfWeek, todayISO } from '../utils.js';

export async function renderMenu(root) {
  const { data: rows, error } = await supabase.from('menu').select('*').order('day_of_week');
  if (error || !rows) { root.innerHTML = `<p class="text-danger">Could not load the menu.</p>`; return; }

  const todayDow = isoDayOfWeek(todayISO());

  root.innerHTML = `
    <div class="menu-week-list">
      ${rows.map(r => `
        <div class="card menu-day-card ${r.day_of_week === todayDow ? 'is-today' : ''}">
          <div class="menu-day-card__day">${DAY_NAMES[r.day_of_week - 1]} ${r.day_of_week === todayDow ? '· Today' : ''}</div>
          <div class="menu-day-card__meal"><b>Breakfast:</b> ${r.breakfast_text || '—'}</div>
          <div class="menu-day-card__meal"><b>Lunch:</b> ${r.lunch_text || '—'}</div>
          <div class="menu-day-card__meal"><b>Dinner:</b> ${r.dinner_text || '—'}</div>
        </div>
      `).join('')}
    </div>
  `;
}
