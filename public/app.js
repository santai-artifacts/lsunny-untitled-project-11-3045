// ---- State ----
let CUSTOMERS = [];
let META = { stages: [], playbook: [], owners: [] };
let VIEW = "board";
let FILTER_OWNER = "";
let SEARCH = "";
let DRAWER_ID = null;

const STAGE_DOTS = {
  "Kickoff": "#8b5cf6",
  "Configuration": "#6366f1",
  "Training": "#0ea5e9",
  "Go-Live": "#f59e0b",
  "Onboarded": "#0d9f6e",
};
const HEALTH_LABEL = { on_track: "On track", at_risk: "At risk", delayed: "Delayed" };
const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#0d9f6e", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444"];

// ---- Helpers ----
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function avatarColor(name) {
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function money(n) {
  n = Number(n) || 0;
  if (n >= 1000) return "$" + (n / 1000).toFixed(n % 1000 ? 1 : 0) + "k";
  return "$" + n;
}
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dt = new Date(d + "T00:00:00");
  return Math.round((dt - today) / 86400000);
}
function dueMeta(d) {
  const n = daysUntil(d);
  if (n === null) return { text: "No target", cls: "" };
  if (n < 0) return { text: `${Math.abs(n)}d overdue`, cls: "overdue" };
  if (n === 0) return { text: "Due today", cls: "soon" };
  if (n <= 7) return { text: `${n}d left`, cls: "soon" };
  return { text: `Live ${fmtDate(d)}`, cls: "" };
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---- Load ----
async function load() {
  [META, CUSTOMERS] = await Promise.all([api("/api/meta"), api("/api/customers")]);
  buildStageOptions();
  buildOwnerFilter();
  render();
}

function buildStageOptions() {
  const sel = $("#stage-select");
  sel.innerHTML = META.stages.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}
function buildOwnerFilter() {
  const owners = [...new Set(CUSTOMERS.map((c) => c.owner).filter(Boolean))].sort();
  $("#filter-owner").innerHTML =
    `<option value="">All owners</option>` +
    owners.map((o) => `<option value="${esc(o)}"${o === FILTER_OWNER ? " selected" : ""}>${esc(o)}</option>`).join("");
  $("#owner-list").innerHTML = owners.map((o) => `<option value="${esc(o)}">`).join("");
}

// ---- Filtering ----
function filtered() {
  const q = SEARCH.toLowerCase();
  return CUSTOMERS.filter((c) => {
    if (FILTER_OWNER && c.owner !== FILTER_OWNER) return false;
    if (q && !(`${c.company} ${c.contact_name} ${c.contact_email}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

// ---- Render ----
function render() {
  renderStats();
  if (VIEW === "board") { $("#board-view").classList.remove("hidden"); $("#table-view").classList.add("hidden"); renderBoard(); }
  else { $("#board-view").classList.add("hidden"); $("#table-view").classList.remove("hidden"); renderTable(); }
}

function renderStats() {
  const list = filtered();
  const active = list.filter((c) => c.stage !== "Onboarded");
  const atRisk = list.filter((c) => (c.health === "at_risk" || c.health === "delayed") && c.stage !== "Onboarded");
  const overdue = list.filter((c) => c.stage !== "Onboarded" && (daysUntil(c.target_date) ?? 99) < 0);
  const live = list.filter((c) => c.stage === "Onboarded");
  const avg = active.length ? Math.round(active.reduce((s, c) => s + c.progress, 0) / active.length) : 0;

  const stats = [
    { label: "In onboarding", value: active.length },
    { label: "Avg. progress", value: `${avg}<small>%</small>`, },
    { label: "At risk", value: atRisk.length, cls: atRisk.length ? "accent-risk" : "" },
    { label: "Overdue", value: overdue.length, cls: overdue.length ? "accent-danger" : "" },
    { label: "Onboarded", value: live.length },
  ];
  $("#stats").innerHTML = stats.map((s) => `
    <div class="stat ${s.cls || ""}">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </div>`).join("");
}

function cardHTML(c) {
  const due = dueMeta(c.target_date);
  const showDue = c.stage !== "Onboarded";
  return `
  <div class="card" draggable="true" data-id="${c.id}">
    <div class="card-top">
      <div>
        <div class="card-company">${esc(c.company)}</div>
        <div class="card-contact">${esc(c.contact_name) || "No contact"}</div>
      </div>
      <span class="health-dot h-${c.health}" title="${HEALTH_LABEL[c.health]}"></span>
    </div>
    <div class="card-meta">
      <span class="chip plan-${esc(c.plan)}">${esc(c.plan)}</span>
      ${c.arr ? `<span class="chip">${money(c.arr)} ARR</span>` : ""}
    </div>
    <div class="progress">
      <div class="progress-bar"><div class="progress-fill" style="width:${c.progress}%"></div></div>
      <div class="progress-row"><span>${c.tasks_done}/${c.tasks_total} tasks</span><span>${c.progress}%</span></div>
    </div>
    <div class="card-foot">
      <div class="owner">
        ${c.owner ? `<span class="avatar" style="background:${avatarColor(c.owner)}">${initials(c.owner)}</span>${esc(c.owner)}` : `<span class="muted">Unassigned</span>`}
      </div>
      ${showDue ? `<span class="due ${due.cls}">${due.text}</span>` : `<span class="due">✓ Live</span>`}
    </div>
  </div>`;
}

function renderBoard() {
  const list = filtered();
  const board = $("#board-view");
  board.innerHTML = META.stages.map((stage) => {
    const items = list.filter((c) => c.stage === stage);
    return `
    <div class="column" data-stage="${esc(stage)}">
      <div class="col-head">
        <span class="col-dot" style="background:${STAGE_DOTS[stage] || "#999"}"></span>
        <span class="col-title">${esc(stage)}</span>
        <span class="col-count">${items.length}</span>
      </div>
      <div class="col-body">
        ${items.map(cardHTML).join("") || `<div class="col-empty">No customers</div>`}
      </div>
    </div>`;
  }).join("");
  wireCards();
  wireDnD();
}

function renderTable() {
  const list = filtered().slice().sort((a, b) => META.stages.indexOf(a.stage) - META.stages.indexOf(b.stage) || b.arr - a.arr);
  const wrap = $("#table-view");
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">📭</div><div>No customers match your filters.</div></div>`;
    return;
  }
  wrap.innerHTML = `
  <table>
    <thead><tr>
      <th>Company</th><th>Stage</th><th>Progress</th><th>Health</th>
      <th>Owner</th><th>Plan</th><th>ARR</th><th>Target</th>
    </tr></thead>
    <tbody>
      ${list.map((c) => {
        const due = dueMeta(c.target_date);
        return `<tr data-id="${c.id}">
          <td><div class="t-company">${esc(c.company)}</div><div class="t-sub">${esc(c.contact_name || "—")}</div></td>
          <td><span class="stage-tag"><span class="col-dot" style="background:${STAGE_DOTS[c.stage]}"></span>${esc(c.stage)}</span></td>
          <td><span class="mini-bar"><span class="mini-fill" style="width:${c.progress}%"></span></span> <span class="t-sub">${c.progress}%</span></td>
          <td><span class="health-badge h-${c.health}"><span class="health-dot"></span>${HEALTH_LABEL[c.health]}</span></td>
          <td>${c.owner ? `<span class="owner"><span class="avatar" style="background:${avatarColor(c.owner)}">${initials(c.owner)}</span>${esc(c.owner)}</span>` : `<span class="muted">—</span>`}</td>
          <td><span class="chip plan-${esc(c.plan)}">${esc(c.plan)}</span></td>
          <td>${c.arr ? money(c.arr) : "—"}</td>
          <td>${c.stage === "Onboarded" ? '<span class="muted">Live</span>' : `<span class="due ${due.cls}">${fmtDate(c.target_date)}</span>`}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
  $$("#table-view tr[data-id]").forEach((tr) => tr.addEventListener("click", () => openDrawer(Number(tr.dataset.id))));
}

// ---- Cards & DnD ----
function wireCards() {
  $$(".card", $("#board-view")).forEach((el) => {
    el.addEventListener("click", () => openDrawer(Number(el.dataset.id)));
  });
}

let dragId = null;
function wireDnD() {
  $$(".card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      dragId = Number(card.dataset.id);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => { card.classList.remove("dragging"); dragId = null; });
  });
  $$(".column").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const stage = col.dataset.stage;
      const id = dragId;
      if (!id) return;
      const cust = CUSTOMERS.find((c) => c.id === id);
      if (!cust || cust.stage === stage) return;
      cust.stage = stage;                 // optimistic
      render();
      try {
        const updated = await api(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
        Object.assign(cust, updated);
        render();
        toast(`${cust.company} → ${stage}`);
      } catch (err) { toast("Couldn't update stage"); load(); }
    });
  });
}

// ---- Drawer ----
async function openDrawer(id) {
  DRAWER_ID = id;
  let data;
  try { data = await api(`/api/customers/${id}`); } catch { toast("Couldn't load customer"); return; }
  renderDrawer(data);
  $("#drawer").classList.remove("hidden");
  $("#drawer-overlay").classList.remove("hidden");
  $("#drawer").setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  $("#drawer").classList.add("hidden");
  $("#drawer-overlay").classList.add("hidden");
  DRAWER_ID = null;
}

function renderDrawer(c) {
  const stageIdx = META.stages.indexOf(c.stage);
  const stepper = META.stages.map((s, i) =>
    `<div class="step ${i < stageIdx ? "done" : i === stageIdx ? "current" : ""}">${esc(s)}</div>`).join("");

  const phases = META.stages;
  const checklist = phases.map((phase) => {
    const items = c.tasks.filter((t) => t.phase === phase);
    if (!items.length) return "";
    const done = items.filter((t) => t.done).length;
    return `
    <div class="phase-group">
      <p class="phase-label">${esc(phase)} <span class="count">${done}/${items.length}</span></p>
      ${items.map((t) => `
        <label class="check ${t.done ? "checked" : ""}">
          <input type="checkbox" data-task="${t.id}" ${t.done ? "checked" : ""}/>
          <span class="txt">${esc(t.title)}</span>
          <button class="icon-btn del" data-deltask="${t.id}" title="Remove">✕</button>
        </label>`).join("")}
    </div>`;
  }).join("");

  $("#drawer").innerHTML = `
    <div class="drawer-head">
      <div class="drawer-head-top">
        <div>
          <div class="drawer-company">${esc(c.company)}</div>
          <div class="drawer-contact">${esc(c.contact_name) || "No contact"}${c.contact_email ? ` · ${esc(c.contact_email)}` : ""}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" id="drawer-edit" title="Edit details">✎</button>
          <button class="icon-btn" id="drawer-close" title="Close">✕</button>
        </div>
      </div>
      <div style="margin-top:14px" class="stepper">${stepper}</div>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <div class="kv">
          <div class="item"><div class="k">Owner</div><div class="v">${c.owner ? esc(c.owner) : "Unassigned"}</div></div>
          <div class="item"><div class="k">Plan</div><div class="v">${esc(c.plan)}</div></div>
          <div class="item"><div class="k">ARR</div><div class="v">${c.arr ? money(c.arr) : "—"}</div></div>
          <div class="item"><div class="k">Started</div><div class="v">${fmtDate(c.start_date)}</div></div>
          <div class="item"><div class="k">Target live</div><div class="v">${fmtDate(c.target_date)}</div></div>
          <div class="item"><div class="k">Progress</div><div class="v">${c.progress}% · ${c.tasks_done}/${c.tasks_total}</div></div>
        </div>
        <div class="drawer-controls">
          <div class="field">
            <label>Stage</label>
            <select id="d-stage">${META.stages.map((s) => `<option ${s === c.stage ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Health</label>
            <select id="d-health">
              ${Object.entries(HEALTH_LABEL).map(([k, v]) => `<option value="${k}" ${k === c.health ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="drawer-section">
        <h3>Onboarding checklist</h3>
        ${checklist || '<p class="muted">No tasks yet.</p>'}
        <div class="add-task">
          <input id="new-task" placeholder="Add a task…" />
          <button class="btn btn-ghost" id="add-task-btn">Add</button>
        </div>
      </div>

      <div class="drawer-section">
        <h3>Notes</h3>
        <textarea class="notes-box" id="d-notes" placeholder="Add context, blockers, next steps…">${esc(c.notes)}</textarea>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-danger" id="drawer-delete">Delete customer</button>
      <span class="saved-flag" id="saved-flag">✓ Saved</span>
    </div>`;

  // wire
  $("#drawer-close").onclick = closeDrawer;
  $("#drawer-edit").onclick = () => { closeDrawer(); openModal(c); };
  $("#drawer-delete").onclick = () => deleteCustomer(c.id, c.company);

  $("#d-stage").onchange = (e) => patchCustomer(c.id, { stage: e.target.value });
  $("#d-health").onchange = (e) => patchCustomer(c.id, { health: e.target.value });

  let noteTimer;
  $("#d-notes").oninput = (e) => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => patchCustomer(c.id, { notes: e.target.value }, true), 600);
  };

  $$('[data-task]', $("#drawer")).forEach((cb) => {
    cb.onchange = async () => {
      await api(`/api/tasks/${cb.dataset.task}`, { method: "PATCH", body: JSON.stringify({ done: cb.checked }) });
      await refreshDrawer();
      refreshList();
    };
  });
  $$('[data-deltask]', $("#drawer")).forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      await api(`/api/tasks/${btn.dataset.deltask}`, { method: "DELETE" });
      await refreshDrawer(); refreshList();
    };
  });
  const addTask = async () => {
    const input = $("#new-task");
    const title = input.value.trim();
    if (!title) return;
    const stage = $("#d-stage").value;
    await api(`/api/customers/${c.id}/tasks`, { method: "POST", body: JSON.stringify({ title, phase: stage }) });
    input.value = "";
    await refreshDrawer(); refreshList();
  };
  $("#add-task-btn").onclick = addTask;
  $("#new-task").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } };
}

async function refreshDrawer() {
  if (!DRAWER_ID) return;
  const data = await api(`/api/customers/${DRAWER_ID}`);
  renderDrawer(data);
}
async function refreshList() {
  CUSTOMERS = await api("/api/customers");
  render();
}
function flashSaved() {
  const f = $("#saved-flag");
  if (!f) return;
  f.classList.add("show");
  setTimeout(() => f.classList.remove("show"), 1200);
}

async function patchCustomer(id, patch, silent) {
  try {
    const updated = await api(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const idx = CUSTOMERS.findIndex((c) => c.id === id);
    if (idx > -1) Object.assign(CUSTOMERS[idx], updated);
    render();
    if (silent) flashSaved();
    else { flashSaved(); await refreshDrawer(); }
  } catch { toast("Save failed"); }
}

async function deleteCustomer(id, name) {
  if (!confirm(`Delete ${name}? This removes all their onboarding data.`)) return;
  await api(`/api/customers/${id}`, { method: "DELETE" });
  closeDrawer();
  await refreshList();
  toast(`${name} deleted`);
}

// ---- Modal (add / edit) ----
function openModal(c) {
  const form = $("#customer-form");
  form.reset();
  $("#modal-title").textContent = c ? "Edit customer" : "New customer";
  $("#modal-save").textContent = c ? "Save changes" : "Create customer";
  form.id.value = c ? c.id : "";
  if (c) {
    form.company.value = c.company;
    form.contact_name.value = c.contact_name || "";
    form.contact_email.value = c.contact_email || "";
    form.owner.value = c.owner || "";
    form.plan.value = c.plan || "Starter";
    form.stage.value = c.stage || "Kickoff";
    form.health.value = c.health || "on_track";
    form.arr.value = c.arr || "";
    form.start_date.value = c.start_date || "";
    form.target_date.value = c.target_date || "";
    form.notes.value = c.notes || "";
  } else {
    form.stage.value = "Kickoff";
    form.start_date.value = new Date().toISOString().slice(0, 10);
  }
  $("#modal-overlay").classList.remove("hidden");
  setTimeout(() => form.company.focus(), 50);
}
function closeModal() { $("#modal-overlay").classList.add("hidden"); }

$("#customer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    company: form.company.value.trim(),
    contact_name: form.contact_name.value.trim(),
    contact_email: form.contact_email.value.trim(),
    owner: form.owner.value.trim(),
    plan: form.plan.value,
    stage: form.stage.value,
    health: form.health.value,
    arr: Number(form.arr.value) || 0,
    start_date: form.start_date.value,
    target_date: form.target_date.value,
    notes: form.notes.value.trim(),
  };
  if (!payload.company) return;
  const id = form.id.value;
  try {
    if (id) {
      await api(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast("Customer updated");
    } else {
      await api("/api/customers", { method: "POST", body: JSON.stringify(payload) });
      toast("Customer added");
    }
    closeModal();
    buildOwnerFilter();
    await refreshList();
    buildOwnerFilter();
  } catch (err) { toast(err.message || "Save failed"); }
});

// ---- Global wiring ----
$("#add-btn").onclick = () => openModal(null);
$("#modal-close").onclick = closeModal;
$("#modal-cancel").onclick = closeModal;
$("#modal-overlay").addEventListener("click", (e) => { if (e.target === $("#modal-overlay")) closeModal(); });
$("#drawer-overlay").onclick = closeDrawer;
$("#search").addEventListener("input", (e) => { SEARCH = e.target.value; render(); });
$("#filter-owner").addEventListener("change", (e) => { FILTER_OWNER = e.target.value; render(); });
$$(".nav-item").forEach((btn) => btn.addEventListener("click", () => {
  $$(".nav-item").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  VIEW = btn.dataset.view;
  $("#view-title").textContent = VIEW === "board" ? "Board" : "All customers";
  $("#view-sub").textContent = VIEW === "board" ? "Track every account from kickoff to live." : "Every account and where it stands.";
  render();
}));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeDrawer(); }
});

load().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">Failed to load: ${esc(err.message)}</div>`;
});
