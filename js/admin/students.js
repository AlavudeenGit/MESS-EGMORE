// ============================================================================
// admin/students.js — student CRUD + activate/deactivate
// "Add Student" calls the `admin-create-student` edge function (see
// supabase/functions/admin-create-student) since creating a login needs the
// service role key, which never runs in the browser. Editing/deactivating
// existing students works directly against the `students` table under RLS.
// ============================================================================
import { supabase } from "../config.js";
import { formatDate, debounce } from "../utils.js";
import { renderTable } from "../components/Table.js";
import { openModal, closeModal, confirmDialog } from "../components/Modal.js";
import { toast } from "../components/Toast.js";

export async function renderStudents(root) {
  root.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <input type="text" id="searchName" placeholder="Search name or room…">
        <select id="filterStatus">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button class="btn btn-primary btn-sm" id="addStudentBtn"><i class="fa-solid fa-plus"></i> Add Student</button>
      </div>
    </div>
    <div id="studentsTable"><div class="skeleton" style="height:220px;border-radius:16px;"></div></div>
  `;

  const state = { search: "", status: "" };

  async function load() {
    let query = supabase
      .from("students")
      .select("*")
      .neq("status", "pending")
      .order("created_at", { ascending: false });
    if (state.status) query = query.eq("status", state.status);
    const { data, error } = await query;
    if (error) {
      document.getElementById("studentsTable").innerHTML =
        `<p class="text-danger">Failed to load students.</p>`;
      return;
    }

    const filtered = state.search
      ? data.filter(
          (s) =>
            s.name.toLowerCase().includes(state.search) ||
            s.room_number.toLowerCase().includes(state.search),
        )
      : data;

    const columns = [
      { key: "name", label: "Name" },
      { key: "room_number", label: "Room" },
      { key: "mobile", label: "Mobile" },
      { key: "email", label: "Email" },
      {
        key: "status",
        label: "Status",
        render: (r) =>
          `<span class="badge ${r.status === "active" ? "badge-yes" : "badge-no"}">${r.status}</span>`,
      },
      {
        key: "actions",
        label: "Actions",
        render: (r) => `
        <div style="display:flex;gap:6px;">
          <button class="icon-btn btn-sm" data-act="edit" data-id="${r.id}" style="width:36px;height:36px;"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn btn-sm" data-act="toggle" data-id="${r.id}" style="width:36px;height:36px;"><i class="fa-solid ${r.status === "active" ? "fa-user-slash" : "fa-user-check"}"></i></button>
          <button class="icon-btn btn-sm" data-act="delete" data-id="${r.id}" style="width:36px;height:36px;"><i class="fa-solid fa-trash text-danger"></i></button>
        </div>`,
      },
    ];
    document.getElementById("studentsTable").innerHTML = renderTable(
      columns,
      filtered,
      { emptyMessage: "No students found" },
    );
    wireRowActions(filtered);
  }

  function wireRowActions(rows) {
    document.querySelectorAll('[data-act="edit"]').forEach(
      (btn) =>
        (btn.onclick = () =>
          openEditModal(
            rows.find((r) => r.id === btn.dataset.id),
            load,
          )),
    );
    document.querySelectorAll('[data-act="toggle"]').forEach(
      (btn) =>
        (btn.onclick = () =>
          toggleStatus(
            rows.find((r) => r.id === btn.dataset.id),
            load,
          )),
    );
    document
      .querySelectorAll('[data-act="delete"]')
      .forEach(
        (btn) =>
          (btn.onclick = () =>
            deleteStudent(
              btn.dataset.id,
              rows.find((r) => r.id === btn.dataset.id)?.name || "this student",
              load,
            )),
      );
  }

  document.getElementById("searchName").addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value.toLowerCase();
      load();
    }, 250),
  );
  document.getElementById("filterStatus").addEventListener("change", (e) => {
    state.status = e.target.value;
    load();
  });
  document
    .getElementById("addStudentBtn")
    .addEventListener("click", () => openAddModal(load));

  load();
}

function openAddModal(onSaved) {
  const body = openModal({
    title: "Add Student",
    bodyHTML: `
      <p class="text-soft" style="font-size:13px;">Creates a login directly — the student can sign in immediately, no approval step needed for students added this way.</p>
      <div class="field"><input id="addName" placeholder=" "><label>Name</label></div>
      <div class="field"><input id="addRoom" placeholder=" "><label>Room number</label></div>
      <div class="field"><input id="addMobile" placeholder=" "><label>Mobile</label></div>
      <div class="field"><input id="addEmail" type="email" placeholder=" "><label>Email (used as username)</label></div>
      <div class="field"><input id="addPassword" type="password" placeholder=" " minlength="6"><label>Temporary password</label></div>
      <button class="btn btn-primary btn-block" id="createStudentBtn">Create Student</button>
    `,
  });
  body.querySelector("#createStudentBtn").onclick = async () => {
    const btn = body.querySelector("#createStudentBtn");
    const payload = {
      name: body.querySelector("#addName").value.trim(),
      room_number: body.querySelector("#addRoom").value.trim(),
      mobile: body.querySelector("#addMobile").value.trim(),
      email: body.querySelector("#addEmail").value.trim(),
      password: body.querySelector("#addPassword").value,
    };
    if (
      !payload.name ||
      !payload.room_number ||
      !payload.mobile ||
      !payload.email ||
      !payload.password
    ) {
      toast.error("All fields are required");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Creating…";
    const { data, error } = await supabase.functions.invoke(
      "admin-create-student",
      { body: payload },
    );
    btn.disabled = false;
    btn.textContent = "Create Student";
    if (error || !data?.ok) {
      toast.error(data?.error || error?.message || "Could not create student");
      return;
    }
    toast.success(`${payload.name} added — they can log in now`);
    closeModal();
    onSaved();
  };
}

function openEditModal(student, onSaved) {
  const body = openModal({
    title: "Edit Student",
    bodyHTML: `
      <div class="field"><input id="editName" value="${student.name}" placeholder=" "><label>Name</label></div>
      <div class="field"><input id="editRoom" value="${student.room_number}" placeholder=" "><label>Room number</label></div>
      <div class="field"><input id="editMobile" value="${student.mobile}" placeholder=" "><label>Mobile</label></div>
      <button class="btn btn-primary btn-block" id="saveStudent">Save Changes</button>
    `,
  });
  body.querySelector("#saveStudent").onclick = async () => {
    const { error } = await supabase
      .from("students")
      .update({
        name: body.querySelector("#editName").value.trim(),
        room_number: body.querySelector("#editRoom").value.trim(),
        mobile: body.querySelector("#editMobile").value.trim(),
      })
      .eq("id", student.id);
    if (error) {
      toast.error("Could not save changes");
      return;
    }
    toast.success("Student updated");
    closeModal();
    onSaved();
  };
}

async function toggleStatus(student, onDone) {
  const newStatus = student.status === "active" ? "inactive" : "active";
  const ok = await confirmDialog(`Mark ${student.name} as ${newStatus}?`, {
    danger: newStatus === "inactive",
    confirmLabel: "Yes, continue",
  });
  if (!ok) return;
  const { error } = await supabase
    .from("students")
    .update({
      status: newStatus,
      deactivated_at:
        newStatus === "inactive" ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", student.id);
  if (error) {
    toast.error("Could not update status");
    return;
  }
  toast.success(`${student.name} is now ${newStatus}`);
  onDone();
}

async function deleteStudent(id, name, onDone) {
  const ok = await confirmDialog(
    `PERMANENTLY delete ${name}? This removes their account and every booking and payment record — it cannot be undone. If you just want to disable their login while keeping their history, use Deactivate instead.`,
    { confirmLabel: "Permanently Delete" },
  );
  if (!ok) return;

  const { data, error } = await supabase.functions.invoke(
    "admin-delete-student",
    { body: { student_id: id } },
  );
  if (error || !data?.ok) {
    toast.error(data?.error || error?.message || "Could not delete student");
    return;
  }
  toast.success(`${name} permanently deleted`);
  onDone();
}
