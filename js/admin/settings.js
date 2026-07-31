// ============================================================================
// admin/settings.js — edit the `settings` table (meal window, No Food
// toggles, per-meal reference rates). Previously this table could only be
// edited via raw SQL; this is the UI for it.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS } from "../config.js";
import { getSettings, invalidateSettingsCache } from "../utils.js";
import { toast } from "../components/Toast.js";

export async function renderSettings(root) {
  const settings = await getSettings(true);

  root.innerHTML = `
    <div class="card">
      <h3>Meal Selection Window</h3>
      <p class="text-soft" style="font-size:13px;">Shared by both tabs in Mark Food — today's confirmation AND tomorrow's booking are only open during this window (default 8:30 PM–11:30 PM). Outside it, students can't select or submit anything. This is enforced using the server's clock, not any student's device, so it can't be bypassed by changing a phone's date/time.</p>
      <p class="text-soft" style="font-size:13px;">If you change these, also update the pg_cron schedule time in supabase/CRON.md so the automatic lock sweep stays in sync.</p>
      <div class="field"><input type="time" id="s_booking_open" value="${settings.booking_open_time}" placeholder=" "><label>Window opens</label></div>
      <div class="field"><input type="time" id="s_booking_close" value="${settings.booking_close_time}" placeholder=" "><label>Window closes</label></div>
    </div>

    <div class="card">
      <h3>No Food Option</h3>
      <p class="text-soft" style="font-size:13px;">When enabled for a meal, students can confirm "No Food" instead of Yes/No/Double.</p>
      ${MEAL_TYPES.map(
        (m) => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border);">
          <input type="checkbox" id="s_nofood_${m}" ${settings[`no_food_enabled_${m}`] === "true" ? "checked" : ""} style="width:20px;height:20px;">
          ${MEAL_LABELS[m]}
        </label>
      `,
      ).join("")}
    </div>

    <div class="card">
      <h3>Per-Meal Rates <span class="badge badge-locked">Reference only</span></h3>
      <p class="text-soft" style="font-size:13px;">Used only to show an estimated Double Food cost on the Payments screen. Never auto-added to a student's mess amount — you decide what to actually charge.</p>
      ${MEAL_TYPES.map(
        (m) => `
        <div class="field"><input type="number" id="s_rate_${m}" value="${settings[`meal_rate_${m}`]}" placeholder=" " min="0"><label>${MEAL_LABELS[m]} rate (₹)</label></div>
      `,
      ).join("")}
    </div>

    <button class="btn btn-primary btn-block" id="saveSettings"><i class="fa-solid fa-floppy-disk"></i> Save Settings</button>
  `;

  document
    .getElementById("saveSettings")
    .addEventListener("click", async () => {
      const btn = document.getElementById("saveSettings");
      btn.disabled = true;
      btn.textContent = "Saving…";

      const updates = {
        booking_open_time: document.getElementById("s_booking_open").value,
        booking_close_time: document.getElementById("s_booking_close").value,
      };
      MEAL_TYPES.forEach((m) => {
        updates[`no_food_enabled_${m}`] = document.getElementById(
          `s_nofood_${m}`,
        ).checked
          ? "true"
          : "false";
        updates[`meal_rate_${m}`] = String(
          Number(document.getElementById(`s_rate_${m}`).value) || 0,
        );
      });

      const rows = Object.entries(updates).map(([key, value]) => ({
        key,
        value,
      }));
      const { error } = await supabase
        .from("settings")
        .upsert(rows, { onConflict: "key" });

      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Settings';

      if (error) {
        toast.error("Could not save settings");
        return;
      }
      invalidateSettingsCache();
      toast.success("Settings saved");
    });
}
