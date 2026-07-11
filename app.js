const SUPABASE_URL = "https://bdyxrbafmpeeeribmveg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_IyIEX7WV3d6b7-RcrQiMTg_aNR1UIbo";

const AUTH_USER = "automecanica lodi";
const AUTH_PASS = "familialodi";
const AUTH_KEY = "automecanica_lodi_auth";

const statusOrder = ["Pendiente", "En progreso", "Finalizado", "Entregado"];

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginScreen = document.getElementById("login-screen");
const appRoot = document.getElementById("app-root");
const loginForm = document.getElementById("login-form");
const loginUser = document.getElementById("login-user");
const loginPass = document.getElementById("login-pass");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

const form = document.getElementById("job-form");
const jobsBody = document.getElementById("jobs-body");
const inProcessBody = document.getElementById("in-process-body");
const searchInput = document.getElementById("search");
const statusFilter = document.getElementById("statusFilter");
const statsContainer = document.getElementById("stats");
const barsContainer = document.getElementById("bars");
const clientSearchInput = document.getElementById("client-search-input");
const clientSearchBody = document.getElementById("client-search-body");
const calendarGrid = document.getElementById("calendar-grid");
const earningsStats = document.getElementById("earnings-stats");
const earningsChart = document.getElementById("earnings-chart");
const earningsModeButtons = Array.from(document.querySelectorAll(".microtab-btn"));
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));

const tabPanels = {
  turnos: document.getElementById("tab-turnos"),
  proceso: document.getElementById("tab-proceso"),
  calendario: document.getElementById("tab-calendario"),
  ganancias: document.getElementById("tab-ganancias"),
  clientes: document.getElementById("tab-clientes")
};

const state = {
  jobs: [],
  clients: [],
  earningsMode: "weekly_desc",
  initialized: false
};

boot();

function boot() {
  loginForm.addEventListener("submit", handleLoginSubmit);
  logoutBtn.addEventListener("click", handleLogout);
  syncTabsVisibility("turnos");

  if (sessionStorage.getItem(AUTH_KEY) === "1") {
    showApp();
    initApp().catch((error) => onError("Inicialización", error));
    return;
  }

  showLogin();
}

async function initApp() {
  if (state.initialized) return;
  state.initialized = true;

  await loadCloudData();
  await migrateClientsFromJobs();

  setTodayAsDefault();
  bindEvents();
  render();
}

function bindEvents() {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const job = buildJobFromForm();

      await insertJob(job);
      await upsertClientFromJob(job);
      state.jobs.unshift(job);

      form.reset();
      setTodayAsDefault();
      render();
    } catch (error) {
      onError("guardar trabajo", error);
    }
  });

  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  clientSearchInput.addEventListener("input", renderClientSearch);

  jobsBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    if (!action || !id) return;

    try {
      if (action === "delete") {
        await deleteJobById(id);
      } else if (action === "next-status") {
        await rotateStatusById(id);
      }

      render();
    } catch (error) {
      onError("actualizar trabajo", error);
    }
  });

  inProcessBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    if (action !== "finalize" || !id) return;

    try {
      await setStatusById(id, "Finalizado");
      render();
    } catch (error) {
      onError("cambiar estado", error);
    }
  });

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) return;
      syncTabsVisibility(tab);
    });
  }

  for (const button of earningsModeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.earningsMode;
      if (!mode) return;
      state.earningsMode = mode;
      renderEarnings();
    });
  }
}

function handleLoginSubmit(event) {
  event.preventDefault();
  const user = String(loginUser.value || "").trim().toLowerCase();
  const pass = String(loginPass.value || "");

  if (user === AUTH_USER && pass === AUTH_PASS) {
    sessionStorage.setItem(AUTH_KEY, "1");
    loginError.textContent = "";
    showApp();
    initApp().catch((error) => onError("Inicialización", error));
    return;
  }

  loginError.textContent = "Usuario o contraseña incorrectos.";
}

function handleLogout() {
  sessionStorage.removeItem(AUTH_KEY);
  showLogin();
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  appRoot.classList.add("hidden");
  loginForm.reset();
  loginError.textContent = "";
  loginUser.focus();
}

function showApp() {
  loginScreen.classList.add("hidden");
  appRoot.classList.remove("hidden");
}

function syncTabsVisibility(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }
  for (const [name, panel] of Object.entries(tabPanels)) {
    if (!panel) continue;
    const isActive = name === tabName;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
    panel.style.display = isActive ? "block" : "none";
  }
}

async function loadCloudData() {
  const jobsResp = await supabaseClient
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (jobsResp.error) throw jobsResp.error;

  const clientsResp = await supabaseClient
    .from("clients")
    .select("*")
    .order("updated_at", { ascending: false });
  if (clientsResp.error) throw clientsResp.error;

  state.jobs = (jobsResp.data || []).map(mapJobRowToModel);
  state.clients = (clientsResp.data || []).map(mapClientRowToModel);
}

function buildJobFromForm() {
  return {
    id: makeId(),
    date: document.getElementById("date").value,
    clientName: document.getElementById("clientName").value.trim(),
    clientPhone: document.getElementById("clientPhone").value.trim(),
    clientDni: document.getElementById("clientDni").value.trim(),
    vehiclePlate: document.getElementById("vehiclePlate").value.trim().toUpperCase(),
    vehicleModel: document.getElementById("vehicleModel").value.trim(),
    task: document.getElementById("task").value.trim(),
    status: document.getElementById("status").value,
    estimatedCost: Number(document.getElementById("estimatedCost").value || 0),
    createdAt: Date.now()
  };
}

async function insertJob(job) {
  const { error } = await supabaseClient.from("jobs").insert(mapJobModelToRow(job));
  if (error) throw error;
}

async function updateJobStatus(id, status) {
  const { error } = await supabaseClient.from("jobs").update({ status }).eq("id", id);
  if (error) throw error;
}

async function deleteJobCloud(id) {
  const { error } = await supabaseClient.from("jobs").delete().eq("id", id);
  if (error) throw error;
}

async function deleteJobById(id) {
  const jobToDelete = state.jobs.find((job) => job.id === id);
  if (jobToDelete) {
    await upsertClientFromJob(jobToDelete);
  }

  await deleteJobCloud(id);
  state.jobs = state.jobs.filter((job) => job.id !== id);
}

async function rotateStatusById(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const idx = statusOrder.indexOf(job.status);
  const next = statusOrder[(idx + 1) % statusOrder.length];
  await setStatusById(id, next);
}

async function setStatusById(id, status) {
  await updateJobStatus(id, status);
  state.jobs = state.jobs.map((job) => (job.id === id ? { ...job, status } : job));
}

async function upsertClientFromJob(job) {
  const id = clientKey(job.clientName, job.clientPhone);
  const existing = state.clients.find((item) => item.id === id);
  const history = existing && Array.isArray(existing.jobs) ? existing.jobs.slice() : [];

  if (!history.some((entry) => entry.date === job.date && entry.task === job.task)) {
    history.push({ date: job.date, task: job.task });
  }

  const client = {
    id,
    clientName: job.clientName,
    clientPhone: job.clientPhone,
    clientDni: job.clientDni || (existing && existing.clientDni) || "",
    vehicleModel: job.vehicleModel,
    vehiclePlate: job.vehiclePlate,
    firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : job.date,
    jobs: history.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    updatedAt: Date.now()
  };

  const { error } = await supabaseClient.from("clients").upsert(mapClientModelToRow(client));
  if (error) throw error;

  const idx = state.clients.findIndex((item) => item.id === client.id);
  if (idx === -1) state.clients.push(client);
  else state.clients[idx] = client;
}

async function migrateClientsFromJobs() {
  for (const job of [...state.jobs].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
    await upsertClientFromJob(job);
  }
}

function render() {
  renderTable(filteredJobs());
  renderInProcessTable();
  renderStats();
  renderCalendar();
  renderEarnings();
  renderClientSearch();
}

function filteredJobs() {
  const text = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;

  return state.jobs.filter((job) => {
    if (status && job.status !== status) return false;
    if (!text) return true;
    return (
      job.clientName.toLowerCase().includes(text) ||
      job.vehiclePlate.toLowerCase().includes(text) ||
      job.task.toLowerCase().includes(text)
    );
  });
}

function renderTable(jobs) {
  jobsBody.innerHTML = "";
  if (jobs.length === 0) {
    jobsBody.innerHTML = `<tr><td colspan="9">No hay registros para mostrar.</td></tr>`;
    return;
  }

  for (const job of jobs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDate(job.date)}</td>
      <td>${escapeHtml(job.clientName)}</td>
      <td>${escapeHtml(job.clientPhone)}</td>
      <td>${escapeHtml(job.vehicleModel)}</td>
      <td>${escapeHtml(job.vehiclePlate)}</td>
      <td>${escapeHtml(job.task)}</td>
      <td><span class="badge ${statusClass(job.status)}">${job.status}</span></td>
      <td>${formatCurrency(job.estimatedCost)}</td>
      <td>
        <button class="icon-btn" data-action="next-status" data-id="${job.id}">Estado</button>
        <button class="icon-btn" data-action="delete" data-id="${job.id}">Eliminar</button>
      </td>
    `;
    jobsBody.appendChild(row);
  }
}

function renderInProcessTable() {
  inProcessBody.innerHTML = "";
  const inProcessJobs = state.jobs
    .filter((job) => job.status === "En progreso")
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

  if (inProcessJobs.length === 0) {
    inProcessBody.innerHTML = `<tr><td colspan="7">No hay trabajos en proceso.</td></tr>`;
    return;
  }

  for (const job of inProcessJobs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDate(job.date)}</td>
      <td>${escapeHtml(job.clientName)}</td>
      <td>${escapeHtml(job.vehicleModel)}</td>
      <td>${escapeHtml(job.vehiclePlate)}</td>
      <td>${escapeHtml(job.task)}</td>
      <td><span class="badge En-progreso">En progreso</span></td>
      <td><button class="action-btn" data-action="finalize" data-id="${job.id}">Finalizado</button></td>
    `;
    inProcessBody.appendChild(row);
  }
}

function renderStats() {
  const weekJobs = jobsInCurrentWeek(state.jobs);
  const byStatus = Object.fromEntries(statusOrder.map((s) => [s, 0]));
  let weeklyRevenue = 0;

  for (const job of weekJobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    if (job.status === "Finalizado" || job.status === "Entregado") {
      weeklyRevenue += job.estimatedCost || 0;
    }
  }

  statsContainer.innerHTML = `
    <div class="stat"><div class="label">Trabajos esta semana</div><div class="value">${weekJobs.length}</div></div>
    <div class="stat"><div class="label">Finalizados + Entregados</div><div class="value">${(byStatus.Finalizado || 0) + (byStatus.Entregado || 0)}</div></div>
    <div class="stat"><div class="label">Ingresos estimados</div><div class="value">${formatCurrency(weeklyRevenue)}</div></div>
  `;

  const max = Math.max(1, ...Object.values(byStatus));
  barsContainer.innerHTML = statusOrder.map((status) => {
    const value = byStatus[status] || 0;
    return `
      <div class="bar-row">
        <span>${status}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
        <strong>${value}</strong>
      </div>
    `;
  }).join("");
}

function renderCalendar() {
  calendarGrid.innerHTML = "";
  const weekDays = getCurrentWeekDays();
  const jobsByDay = groupWeekJobsByDate(state.jobs);

  for (const day of weekDays) {
    const jobs = jobsByDay.get(day.key) || [];
    const card = document.createElement("article");
    card.className = "calendar-day";
    const list = jobs.length === 0
      ? "<li>Sin turnos</li>"
      : jobs.map((job) => `<li>${escapeHtml(job.clientName)} - ${escapeHtml(job.task)}</li>`).join("");

    card.innerHTML = `
      <h3>${day.name}</h3>
      <p>${formatDate(day.key)} (${jobs.length} turno${jobs.length === 1 ? "" : "s"})</p>
      <ul>${list}</ul>
    `;
    calendarGrid.appendChild(card);
  }
}

function renderEarnings() {
  syncEarningsModeButtons();

  if (state.earningsMode === "monthly_total") {
    renderMonthlyEarnings();
    return;
  }

  const weekJobs = jobsInCurrentWeek(state.jobs)
    .filter((job) => job.status === "Finalizado" || job.status === "Entregado")
    .sort((a, b) => {
      const diff = Number(a.estimatedCost || 0) - Number(b.estimatedCost || 0);
      return state.earningsMode === "weekly_asc" ? diff : -diff;
    });

  const total = weekJobs.reduce((acc, item) => acc + Number(item.estimatedCost || 0), 0);
  earningsStats.innerHTML = `
    <div class="stat"><div class="label">Ganancia semanal total</div><div class="value">${formatCurrency(total)}</div></div>
    <div class="stat"><div class="label">Trabajos cobrados</div><div class="value">${weekJobs.length}</div></div>
    <div class="stat"><div class="label">Promedio por trabajo</div><div class="value">${formatCurrency(weekJobs.length ? total / weekJobs.length : 0)}</div></div>
  `;

  if (weekJobs.length === 0) {
    earningsChart.innerHTML = `<p>No hay trabajos finalizados o entregados esta semana.</p>`;
    return;
  }

  const caption = state.earningsMode === "weekly_asc"
    ? "Ordenado por dinero ganado: menor a mayor"
    : "Ordenado por dinero ganado: mayor a menor";

  const items = weekJobs.map((job) => ({
    label: `${job.clientName} - ${job.task}`,
    value: Number(job.estimatedCost || 0)
  }));
  earningsChart.innerHTML = buildPointsChartMarkup(items, caption);
}

function renderMonthlyEarnings() {
  const paidJobs = state.jobs.filter((job) => job.status === "Finalizado" || job.status === "Entregado");
  const monthlyMap = new Map();

  for (const job of paidJobs) {
    const month = String(job.date || "").slice(0, 7);
    if (!month) continue;
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + Number(job.estimatedCost || 0));
  }

  const months = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  const total = months.reduce((acc, item) => acc + item.value, 0);
  earningsStats.innerHTML = `
    <div class="stat"><div class="label">Total acumulado mensual</div><div class="value">${formatCurrency(total)}</div></div>
    <div class="stat"><div class="label">Meses con ingresos</div><div class="value">${months.length}</div></div>
    <div class="stat"><div class="label">Promedio por mes</div><div class="value">${formatCurrency(months.length ? total / months.length : 0)}</div></div>
  `;

  if (months.length === 0) {
    earningsChart.innerHTML = `<p>No hay ingresos mensuales disponibles.</p>`;
    return;
  }

  earningsChart.innerHTML = buildPointsChartMarkup(months, "Totales mensuales (orden cronologico)");
}

function buildPointsChartMarkup(items, caption) {
  const width = Math.max(680, items.length * 90);
  const height = 280;
  const padding = { top: 20, right: 20, bottom: 40, left: 30 };
  const maxValue = Math.max(1, ...items.map((item) => Number(item.value || 0)));
  const minValue = Math.min(0, ...items.map((item) => Number(item.value || 0)));
  const range = Math.max(1, maxValue - minValue);
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = items.map((item, idx) => {
    const value = Number(item.value || 0);
    const x = padding.left + (items.length === 1 ? chartW / 2 : (idx * chartW) / (items.length - 1));
    const y = padding.top + ((maxValue - value) / range) * chartH;
    return { item, value, x, y };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const dots = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" class="dot-point"><title>${escapeHtml(p.item.label)} (${formatCurrency(p.value)})</title></circle>`).join("");
  const labels = points.map((p, i) => `
    <div class="point-row">
      <span class="point-rank">#${i + 1}</span>
      <span class="point-job">${escapeHtml(p.item.label)}</span>
      <strong class="point-money">${formatCurrency(p.value)}</strong>
    </div>
  `).join("");

  return `
    <div class="points-chart-wrap">
      <div class="points-caption">${escapeHtml(caption)}</div>
      <div class="points-svg-scroll">
        <svg viewBox="0 0 ${width} ${height}" class="points-svg" role="img" aria-label="Ganancias por trabajo">
          <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="axis-line"></line>
          <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="axis-line"></line>
          <polyline points="${polyline}" class="line-path"></polyline>
          ${dots}
        </svg>
      </div>
      <div class="points-list">${labels}</div>
    </div>
  `;
}

function renderClientSearch() {
  const text = clientSearchInput.value.trim().toLowerCase();
  clientSearchBody.innerHTML = "";

  const clients = [...state.clients]
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .filter((client) => {
      if (!text) return true;
      return (
        String(client.clientName || "").toLowerCase().includes(text) ||
        String(client.clientPhone || "").toLowerCase().includes(text) ||
        String(client.vehicleModel || "").toLowerCase().includes(text) ||
        String(client.vehiclePlate || "").toLowerCase().includes(text) ||
        String(client.clientDni || "").toLowerCase().includes(text)
      );
    });

  if (clients.length === 0) {
    clientSearchBody.innerHTML = `<tr><td colspan="7">No hay clientes para mostrar.</td></tr>`;
    return;
  }

  for (const client of clients) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(client.clientName)}</td>
      <td>${escapeHtml(client.vehicleModel)}</td>
      <td>${escapeHtml(client.vehiclePlate)}</td>
      <td>${escapeHtml(client.clientPhone)}</td>
      <td>${escapeHtml(client.clientDni || "-")}</td>
      <td>${formatDate(client.firstSeenAt || "")}</td>
      <td>${renderClientJobs(client.jobs || [])}</td>
    `;
    clientSearchBody.appendChild(row);
  }
}

function renderClientJobs(jobs) {
  if (!jobs.length) return "-";

  return `
    <div class="client-jobs">
      ${jobs.map((job) => `<div class="client-job-item"><span>${formatDate(job.date)}</span><strong>${escapeHtml(job.task)}</strong></div>`).join("")}
    </div>
  `;
}

function syncEarningsModeButtons() {
  for (const button of earningsModeButtons) {
    button.classList.toggle("active", button.dataset.earningsMode === state.earningsMode);
  }
}

function setTodayAsDefault() {
  const dateField = document.getElementById("date");
  dateField.value = new Date().toISOString().slice(0, 10);
}

function jobsInCurrentWeek(jobs) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return jobs.filter((job) => {
    const d = new Date(job.date + "T00:00:00");
    return d >= start && d < end;
  });
}

function buildWeeklySnapshot(jobs) {
  const weekJobs = jobsInCurrentWeek(jobs);
  let revenue = 0;
  let completedJobs = 0;
  for (const job of weekJobs) {
    if (job.status === "Finalizado" || job.status === "Entregado") {
      completedJobs += 1;
      revenue += job.estimatedCost || 0;
    }
  }
  return {
    weekKey: currentWeekKey(),
    totalJobs: weekJobs.length,
    completedJobs,
    revenue,
    updatedAt: Date.now()
  };
}

function groupWeekJobsByDate(jobs) {
  const map = new Map();
  for (const day of getCurrentWeekDays()) {
    map.set(day.key, []);
  }
  for (const job of jobsInCurrentWeek(jobs)) {
    if (map.has(job.date)) {
      map.get(job.date).push(job);
    }
  }
  return map;
}

function getCurrentWeekDays() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - diffToMonday);
  const names = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
  const result = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    result.push({ key: toISODate(d), name: names[i] });
  }
  return result;
}

function currentWeekKey() {
  const now = new Date();
  return `${now.getFullYear()}-W${String(getWeekNumber(now)).padStart(2, "0")}`;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapJobModelToRow(job) {
  return {
    id: job.id,
    date: job.date,
    client_name: job.clientName,
    client_phone: job.clientPhone,
    client_dni: job.clientDni || "",
    vehicle_plate: job.vehiclePlate,
    vehicle_model: job.vehicleModel,
    task: job.task,
    status: job.status,
    estimated_cost: Number(job.estimatedCost || 0),
    created_at: Number(job.createdAt || Date.now())
  };
}

function mapJobRowToModel(row) {
  return {
    id: row.id,
    date: row.date,
    clientName: row.client_name || "",
    clientPhone: row.client_phone || "",
    clientDni: row.client_dni || "",
    vehiclePlate: row.vehicle_plate || "",
    vehicleModel: row.vehicle_model || "",
    task: row.task || "",
    status: row.status || "Pendiente",
    estimatedCost: Number(row.estimated_cost || 0),
    createdAt: Number(row.created_at || Date.now())
  };
}

function mapClientModelToRow(client) {
  return {
    id: client.id,
    client_name: client.clientName,
    client_phone: client.clientPhone,
    client_dni: client.clientDni || "",
    vehicle_model: client.vehicleModel,
    vehicle_plate: client.vehiclePlate,
    first_seen_at: client.firstSeenAt || null,
    jobs: client.jobs || [],
    updated_at: Number(client.updatedAt || Date.now())
  };
}

function mapClientRowToModel(row) {
  return {
    id: row.id,
    clientName: row.client_name || "",
    clientPhone: row.client_phone || "",
    clientDni: row.client_dni || "",
    vehicleModel: row.vehicle_model || "",
    vehiclePlate: row.vehicle_plate || "",
    firstSeenAt: row.first_seen_at || "",
    jobs: Array.isArray(row.jobs) ? row.jobs : [],
    updatedAt: Number(row.updated_at || Date.now())
  };
}

function clientKey(clientName, clientPhone) {
  return `${clientName.trim().toLowerCase()}__${clientPhone.trim()}`;
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function statusClass(status) {
  return status.replace(/\s+/g, "-");
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value + "T00:00:00");
  return d.toLocaleDateString("es-AR");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function onError(action, error) {
  console.error(`${action}:`, error);
  const msg = typeof error === "string" ? error : (error && error.message) ? error.message : "Error desconocido";
  alert(`Error en ${action}: ${msg}`);
}
