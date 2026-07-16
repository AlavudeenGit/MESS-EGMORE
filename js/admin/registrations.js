// ============================================================================
// admin/registrations.js — approve / reject / edit / delete pending registrations
// ============================================================================
import { supabase } from "../config.js";
import { formatDate } from "../utils.js";
import { renderTable } from "../components/Table.js";
import { openModal, closeModal, confirmDialog } from "../components/Modal.js";
import { toast } from "../components/Toast.js";

export async function renderRegistrations(root) {
  root.innerHTML = `<div id="regTable"><div class="skeleton" style="height:220px;border-radius:16px;"></div></div>`;

  async function load() {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) {
      document.getElementById("regTable").innerHTML =
        `<p class="text-danger">Failed to load registrations.</p>`;
      return;
    }

    const columns = [
      { key: "name", label: "Name" },
      { key: "room_number", label: "Room" },
      { key: "mobile", label: "Mobile" },
      { key: "email", label: "Email" },
      {
        key: "created_at",
        label: "Requested",
        render: (r) => formatDate((r.created_at || "").slice(0, 10)),
      },
      {
        key: "actions",
        label: "Actions",
        render: (r) => `
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary btn-sm" data-act="approve" data-id="${r.id}">Approve</button>
          <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${r.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-act="reject" data-id="${r.id}">Reject</button>
        </div>`,
      },
    ];
    document.getElementById("regTable").innerHTML = renderTable(columns, data, {
      emptyMessage: "No pending registrations 🎉",
    });

    document
      .querySelectorAll('[data-act="approve"]')
      .forEach((b) => (b.onclick = () => approve(b.dataset.id, load)));
    document
      .querySelectorAll('[data-act="reject"]')
      .forEach((b) => (b.onclick = () => reject(b.dataset.id, load)));
    document.querySelectorAll('[data-act="edit"]').forEach(
      (b) =>
        (b.onclick = () =>
          openEdit(
            data.find((r) => r.id === b.dataset.id),
            load,
          )),
    );
  }

  load();
}

async function approve(id, onDone) {
  const ok = await confirmDialog(
    "Approve this registration? The student will be able to log in immediately.",
    { danger: false, confirmLabel: "Approve" },
  );
  if (!ok) return;
  const { error } = await supabase
    .from("students")
    .update({ status: "active" })
    .eq("id", id);
  if (error) {
    toast.error("Could not approve");
    return;
  }
  toast.success("Registration approved");
  onDone();
}

async function reject(id, onDone) {
  const ok = await confirmDialog(
    "Reject this registration? The student will not be able to log in.",
    { confirmLabel: "Reject" },
  );
  if (!ok) return;
  const { error } = await supabase
    .from("students")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) {
    toast.error("Could not reject");
    return;
  }
  toast.success("Registration rejected");
  onDone();
}

function openEdit(student, onSaved) {
  const body = openModal({
    title: "Edit Registration",
    bodyHTML: `
      <div class="field"><input id="rName" value="${student.name}" placeholder=" "><label>Name</label></div>
      <div class="field"><input id="rRoom" value="${student.room_number}" placeholder=" "><label>Room number</label></div>
      <div class="field"><input id="rMobile" value="${student.mobile}" placeholder=" "><label>Mobile</label></div>
      <button class="btn btn-primary btn-block" id="rSave">Save</button>
    `,
  });
  body.querySelector("#rSave").onclick = async () => {
    const { error } = await supabase
      .from("students")
      .update({
        name: body.querySelector("#rName").value.trim(),
        room_number: body.querySelector("#rRoom").value.trim(),
        mobile: body.querySelector("#rMobile").value.trim(),
      })
      .eq("id", student.id);
    if (error) {
      toast.error("Could not save");
      return;
    }
    toast.success("Registration updated");
    closeModal();
    onSaved();
  };
}
