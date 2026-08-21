const APP_DEFAULTS = {
  app_title: "Plan Graph",
  state_source: "examples/compas-ecosystem.sample.json",
  storage_prefix: "plan-graph",
  default_view: "meta-window",
  allow_state_query_param: true,
  set_manifest: "config/sets/index.json",
  default_set: "compas-finance",
};

const el = {
  appTitle: document.getElementById("appTitle"),
  appSubtitle: document.getElementById("appSubtitle"),
  healthCluster: document.getElementById("healthCluster"),
  revisionStat: document.getElementById("revisionStat"),
  healthStat: document.getElementById("healthStat"),
  alertsStat: document.getElementById("alertsStat"),
  blockedStat: document.getElementById("blockedStat"),
  metaTaskBar: document.getElementById("metaTaskBar"),
  setSelect: document.getElementById("setSelect"),
  refreshButton: document.getElementById("refreshButton"),
  addProjectButton: document.getElementById("addProjectButton"),
  compassSvg: document.getElementById("graphSvg"),
  compassViewport: document.getElementById("graphViewport"),
  compassTooltip: document.getElementById("tooltip"),
  graphSvg: document.getElementById("graphSvg"),
  graphViewport: document.getElementById("graphViewport"),
  tooltip: document.getElementById("tooltip"),
  drawer: document.getElementById("drawer"),
  drawerMode: document.getElementById("drawerMode"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerRevision: document.getElementById("drawerRevision"),
  drawerBaseRevision: document.getElementById("drawerBaseRevision"),
  drawerTabs: document.getElementById("drawerTabs"),
  drawerBody: document.getElementById("drawerBody"),
  closeDrawerButton: document.getElementById("closeDrawerButton"),
  saveButton: document.getElementById("saveButton"),
  validationSummary: document.getElementById("validationSummary"),
  patchPreview: document.getElementById("patchPreview"),
};

const state = {
  config: null,
  manifest: null,
  availableSets: [],
  selectedSetKey: null,
  selectedSetLabel: null,
  configUrl: null,
  manifestUrl: null,
  server: null,
  draft: null,
  original: null,
  draftKind: null,
  draftNodeType: "project",
  selectedNodeId: null,
  selectedEdgeId: null,
  activeSection: "identity_and_role",
  simulation: null,
  zoom: null,
  resizeObserver: null,
  graphReady: false,
  sourceUrl: null,
  storageKey: null,
  docsManifest: null,
  docsContentByPath: {},
  selectedDocPath: null,
  docDraft: "",
  docsFolderHandle: null,
  docsFileHandles: {},
};

const PROJECT_SECTIONS = [
  "identity_and_role",
  "interfaces_and_flows",
  "scheduler",
  "roadmap_and_tasks",
  "docs",
  "export_and_commit",
];

function clone(value) {
  return structuredClone(value);
}

function nowUtc() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uuid(prefix = "id") {
  if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|,/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function arrayToText(value) {
  return ensureArray(value).join("\n");
}

function toIsoOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const iso = new Date(value).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function loadJsonFromStorage(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveJsonToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
}

function resolveUrl(base, relativeOrAbsolute) {
  return new URL(relativeOrAbsolute, base).toString();
}

function joinUrl(base, relative) {
  return new URL(relative, base).toString();
}

function normalizeSetManifest(raw) {
  return {
    default_set: raw?.default_set ?? null,
    sets: Array.isArray(raw?.sets)
      ? raw.sets
          .filter((item) => item && item.key && item.config_url)
          .map((item) => ({
            key: item.key,
            label: item.label || item.key,
            config_url: item.config_url,
            description: item.description || "",
          }))
      : [],
  };
}

function inferStorageKey(config, sourceUrl, ecosystemId, setKey = null) {
  const prefix = config.storage_prefix || APP_DEFAULTS.storage_prefix;
  return `${prefix}::${setKey || ecosystemId || sourceUrl}`;
}

function deriveMetaTasks(projects = []) {
  return projects.flatMap((project) => {
    const projectId = project?.identity_and_role?.project_id || "";
    return (project?.roadmap_and_tasks || [])
      .filter((task) => task.show_in_meta && task.status !== "done")
      .map((task) => ({
        project_id: projectId,
        task_id: task.task_id,
        title: task.title,
        priority: task.priority,
        status: task.status,
      }));
  });
}

function normalizeState(raw) {
  const next = clone(raw);
  next.state ??= {};
  next.meta_window ??= {};
  next.meta_window.graph ??= { nodes: [], edges: [], layout: { engine: "d3-force", version: "1" } };
  next.meta_window.health ??= {
    status: "unknown",
    checked_at_utc: nowUtc(),
    active_projects: 0,
    blocked_tasks: 0,
    open_alerts: 0,
  };
  next.meta_window.alerts ??= [];
  next.meta_window.meta_tasks ??= deriveMetaTasks(next.projects || []);
  next.projects ??= [];
  next.projects = next.projects.map(normalizeProject);
  if (!next.meta_window.graph.layout) {
    next.meta_window.graph.layout = { engine: "d3-force", version: "1" };
  }
  return next;
}

function normalizeProject(project) {
  const next = clone(project);
  next.identity_and_role ??= {
    project_id: "",
    name: "",
    description: "",
    role: "",
    operational_status: "idle",
  };
  next.interfaces_and_flows ??= { inputs: [], outputs: [], external_apis: [] };
  next.interfaces_and_flows.inputs ??= [];
  next.interfaces_and_flows.outputs ??= [];
  next.interfaces_and_flows.external_apis ??= [];
  next.scheduler ??= {
    cron_expression: null,
    next_run_utc: null,
    execution_type: "not_scheduled",
    requires_manual_login: false,
    timezone: "UTC",
  };
  next.roadmap_and_tasks ??= [];
  next.export_and_commit ??= { patch_protocol: "json_patch_rfc6902", last_patch: null, commit_message_template: "" };
  next.roadmap_and_tasks = next.roadmap_and_tasks.map(normalizeTask);
  return next;
}

function normalizeTask(task) {
  return {
    task_id: task.task_id || uuid("task"),
    title: task.title || "",
    type: task.type || "roadmap_task",
    status: task.status || "planned",
    priority: task.priority || "medium",
    show_in_meta: Boolean(task.show_in_meta),
    blocked_reason: task.blocked_reason ?? null,
    due_at_utc: task.due_at_utc ?? null,
  };
}

function normalizeNode(node) {
  return {
    node_id: node.node_id || uuid("node"),
    node_type: node.node_type || "project",
    label: node.label || node.project_ref || node.node_id || "Node",
    project_ref: node.project_ref ?? null,
    status: node.status || "idle",
    position: node.position || null,
    tags: node.tags || [],
  };
}

function normalizeEdge(edge) {
  return {
    edge_id: edge.edge_id || uuid("edge"),
    label: edge.label || "",
    source_node: edge.source_node || "",
    target_node: edge.target_node || "",
    channel_type: edge.channel_type || "direct_push",
    payload_format: edge.payload_format || "JSON",
    protocol: edge.protocol || "internal",
    status: edge.status || "unknown",
    last_success_at_utc: edge.last_success_at_utc ?? null,
  };
}

function getProjectNodeRef(project) {
  return project.identity_and_role.project_id;
}

function createProjectNodeFromProject(project, nodeType = "project") {
  const projectId = getProjectNodeRef(project);
  return {
    node_id: projectId,
    node_type: nodeType,
    label: project.identity_and_role.name || projectId,
    project_ref: projectId,
    status: project.identity_and_role.operational_status || "idle",
    position: { x: 400, y: 240, pinned: false },
    tags: [],
  };
}

function createEmptyProject(input) {
  const projectId = input.project_id.trim();
  const status = input.status || "idle";
  return {
    project: {
      identity_and_role: {
        project_id: projectId,
        name: input.name.trim(),
        description: input.description || "",
        role: input.role || "",
        operational_status: status,
      },
      interfaces_and_flows: {
        inputs: [],
        outputs: [],
        external_apis: [],
      },
      scheduler: {
        cron_expression: null,
        next_run_utc: null,
        execution_type: "not_scheduled",
        requires_manual_login: false,
        timezone: "UTC",
      },
      roadmap_and_tasks: [],
      export_and_commit: {
        patch_protocol: "json_patch_rfc6902",
        last_patch: null,
        commit_message_template: `Update ${projectId}: {summary}`,
      },
    },
    node: {
      node_id: projectId,
      node_type: input.node_type || "project",
      label: input.name.trim(),
      project_ref: projectId,
      status,
      position: { x: 420, y: 260, pinned: false },
      tags: [],
    },
  };
}

function validateIsoDateTime(value) {
  if (value == null) return true;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function validateState(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return ["State payload is missing or invalid."];
  }
  if (!candidate.schema_version || !/^\d+\.\d+\.\d+$/.test(candidate.schema_version)) {
    errors.push("schema_version must match X.Y.Z.");
  }
  if (!candidate.state || typeof candidate.state !== "object") {
    errors.push("state envelope is required.");
  } else {
    if (!Number.isInteger(candidate.state.revision) || candidate.state.revision < 1) errors.push("state.revision must be a positive integer.");
    if (!candidate.state.ecosystem_id) errors.push("state.ecosystem_id is required.");
    if (!candidate.state.updated_by) errors.push("state.updated_by is required.");
    if (!validateIsoDateTime(candidate.state.updated_at_utc)) errors.push("state.updated_at_utc must be ISO-8601.");
    if (!candidate.state.lock || !["unlocked", "optimistic", "locked"].includes(candidate.state.lock.mode)) {
      errors.push("state.lock.mode is invalid.");
    }
  }

  const meta = candidate.meta_window;
  if (!meta || typeof meta !== "object") {
    errors.push("meta_window is required.");
  } else {
    if (!meta.graph || typeof meta.graph !== "object") errors.push("meta_window.graph is required.");
    if (!meta.health || typeof meta.health !== "object") errors.push("meta_window.health is required.");
    if (meta.health && !["healthy", "degraded", "critical", "unknown"].includes(meta.health.status)) errors.push("meta_window.health.status is invalid.");
    if (meta.health && !validateIsoDateTime(meta.health.checked_at_utc)) errors.push("meta_window.health.checked_at_utc must be ISO-8601.");
    if (meta.health && (!Number.isInteger(meta.health.active_projects) || meta.health.active_projects < 0)) errors.push("meta_window.health.active_projects must be >= 0.");
    if (meta.health && (!Number.isInteger(meta.health.blocked_tasks) || meta.health.blocked_tasks < 0)) errors.push("meta_window.health.blocked_tasks must be >= 0.");
    if (meta.health && (!Number.isInteger(meta.health.open_alerts) || meta.health.open_alerts < 0)) errors.push("meta_window.health.open_alerts must be >= 0.");
  }

  const projects = Array.isArray(candidate.projects) ? candidate.projects : [];
  const projectIds = new Set();
  for (const project of projects) {
    const id = project?.identity_and_role?.project_id;
    if (!id) errors.push("Each project needs identity_and_role.project_id.");
    if (id && projectIds.has(id)) errors.push(`Duplicate project_id: ${id}`);
    if (id) projectIds.add(id);
    const identity = project?.identity_and_role || {};
    if (!identity.name) errors.push(`Project ${id || "<unknown>"} needs a name.`);
    if (!identity.description && identity.description !== "") errors.push(`Project ${id || "<unknown>"} needs a description.`);
    if (!identity.role && identity.role !== "") errors.push(`Project ${id || "<unknown>"} needs a role.`);
    if (!["active", "idle", "error"].includes(identity.operational_status)) errors.push(`Project ${id || "<unknown>"} has invalid operational_status.`);

    const scheduler = project?.scheduler || {};
    if (scheduler.cron_expression !== null && typeof scheduler.cron_expression !== "string") errors.push(`Project ${id} cron_expression must be string or null.`);
    if (!scheduler.execution_type || !["automated_api", "local_worker", "manual_run", "not_scheduled"].includes(scheduler.execution_type)) errors.push(`Project ${id} has invalid execution_type.`);
    if (scheduler.next_run_utc !== null && !validateIsoDateTime(scheduler.next_run_utc)) errors.push(`Project ${id} next_run_utc must be ISO-8601 or null.`);

    const tasks = Array.isArray(project?.roadmap_and_tasks) ? project.roadmap_and_tasks : [];
    for (const task of tasks) {
      if (!task.task_id) errors.push(`Project ${id} has task without task_id.`);
      if (!task.title) errors.push(`Project ${id} task ${task.task_id || "<unknown>"} needs a title.`);
      if (!["api_job", "roadmap_task"].includes(task.type)) errors.push(`Project ${id} task ${task.task_id || "<unknown>"} has invalid type.`);
      if (!["planned", "in_progress", "done", "blocked"].includes(task.status)) errors.push(`Project ${id} task ${task.task_id || "<unknown>"} has invalid status.`);
      if (!["low", "medium", "high", "urgent"].includes(task.priority)) errors.push(`Project ${id} task ${task.task_id || "<unknown>"} has invalid priority.`);
    }
  }

  const nodes = meta?.graph?.nodes || [];
  const edges = meta?.graph?.edges || [];
  const nodeIds = new Set();
  for (const node of nodes) {
    const id = node?.node_id;
    if (!id) errors.push("Graph node missing node_id.");
    if (id && nodeIds.has(id)) errors.push(`Duplicate node_id: ${id}`);
    if (id) nodeIds.add(id);
    if (!id || !["project", "agent", "external_system"].includes(node.node_type)) errors.push(`Graph node ${id || "<unknown>"} has invalid node_type.`);
    if (!node.label) errors.push(`Graph node ${id || "<unknown>"} needs a label.`);
    if (!["active", "idle", "error"].includes(node.status)) errors.push(`Graph node ${id || "<unknown>"} has invalid status.`);
  }
  for (const edge of edges) {
    if (!edge.edge_id) errors.push("Graph edge missing edge_id.");
    if (!edge.label) errors.push(`Graph edge ${edge.edge_id || "<unknown>"} needs a label.`);
    if (!edge.source_node || !nodeIds.has(edge.source_node)) errors.push(`Edge ${edge.edge_id || "<unknown>"} source_node is missing or unknown.`);
    if (!edge.target_node || !nodeIds.has(edge.target_node)) errors.push(`Edge ${edge.edge_id || "<unknown>"} target_node is missing or unknown.`);
    if (!["direct_push", "queue", "webhook", "polling", "manual_upload", "scheduled_pull"].includes(edge.channel_type)) errors.push(`Edge ${edge.edge_id || "<unknown>"} has invalid channel_type.`);
    if (!["CSV", "JSON", "HTML", "PDF", "TXT", "REST_JSON", "EMAIL", "MIXED"].includes(edge.payload_format)) errors.push(`Edge ${edge.edge_id || "<unknown>"} has invalid payload_format.`);
    if (!["imap", "smtp", "rest", "filesystem", "database", "queue", "webhook", "manual", "internal"].includes(edge.protocol)) errors.push(`Edge ${edge.edge_id || "<unknown>"} has invalid protocol.`);
    if (!["healthy", "degraded", "blocked", "unknown"].includes(edge.status)) errors.push(`Edge ${edge.edge_id || "<unknown>"} has invalid status.`);
    if (edge.last_success_at_utc !== null && edge.last_success_at_utc !== undefined && !validateIsoDateTime(edge.last_success_at_utc)) {
      errors.push(`Edge ${edge.edge_id || "<unknown>"} last_success_at_utc must be ISO-8601 or null.`);
    }
  }

  for (const project of projects) {
    const id = project.identity_and_role.project_id;
    if (!nodeIds.has(id)) errors.push(`Missing graph node for project_id: ${id}`);
  }

  return errors;
}

function setSummary(text, kind = "") {
  el.validationSummary.textContent = text || "";
  el.validationSummary.dataset.state = kind;
}

function setDrawerOpen(open) {
  el.drawer.classList.toggle("open", open);
  el.drawer.setAttribute("aria-hidden", String(!open));
}

function selectSection(section) {
  state.activeSection = section;
  [...el.drawerTabs.querySelectorAll(".tab")].forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  [...el.drawerBody.querySelectorAll(".section-card")].forEach((sectionEl) => {
    if (!PROJECT_SECTIONS.includes(sectionEl.dataset.section)) return;
    sectionEl.classList.toggle("active", sectionEl.dataset.section === section);
  });
}

function findProjectIndex(projectId) {
  return state.server.projects.findIndex((project) => project.identity_and_role.project_id === projectId);
}

function findNodeIndex(projectId) {
  return state.server.meta_window.graph.nodes.findIndex((node) => node.project_ref === projectId || node.node_id === projectId);
}

function findEdgeIndex(edgeId) {
  return state.server.meta_window.graph.edges.findIndex((edge) => edge.edge_id === edgeId);
}

function getMetaTasks() {
  const tasks = state.server.meta_window.meta_tasks || [];
  if (tasks.length) return tasks;
  return deriveMetaTasks(state.server.projects);
}

function renderTopbar() {
  const health = state.server.meta_window.health;
  const alerts = state.server.meta_window.alerts || [];
  const tasks = getMetaTasks().filter((task) => task.priority === "high" || task.priority === "urgent");

  el.appTitle.textContent = state.config.app_title || APP_DEFAULTS.app_title;
  el.appSubtitle.textContent = `${state.server.schema_version} • ${state.server.state.ecosystem_id}${state.selectedSetLabel ? ` • ${state.selectedSetLabel}` : ""}`;
  el.revisionStat.textContent = String(state.server.state.revision);
  el.healthStat.textContent = health.status;
  el.alertsStat.textContent = String(health.open_alerts ?? alerts.filter((a) => a.status === "open").length);
  el.blockedStat.textContent = String(health.blocked_tasks ?? tasks.filter((t) => t.status === "blocked").length);

  el.healthCluster.innerHTML = `
    <span class="health-pill" data-health="${escapeHtml(health.status)}">Health: ${escapeHtml(health.status)}</span>
    <span class="health-pill" data-health="unknown">Open alerts: ${escapeHtml(health.open_alerts ?? alerts.length)}</span>
  `;

  el.metaTaskBar.innerHTML = tasks.length
    ? tasks
        .slice(0, 8)
        .map((task) => `
          <button class="task-chip" data-project-id="${escapeHtml(task.project_id)}">
            <strong>${escapeHtml(task.priority)}</strong>
            <span>${escapeHtml(task.title)}</span>
          </button>
        `)
        .join("")
    : `<span class="stat__label">No urgent or high-priority tasks.</span>`;

  el.metaTaskBar.querySelectorAll(".task-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const projectId = button.dataset.projectId;
      if (projectId) openProjectDrawer(projectId);
    });
  });

  renderSetSwitcher();
}

function renderSetSwitcher() {
  if (!el.setSelect) return;
  const sets = state.availableSets || [];
  const switcher = el.setSelect.closest(".set-switcher");
  if (switcher) {
    switcher.style.display = sets.length > 1 ? "flex" : "none";
  }
  if (sets.length <= 1) return;

  el.setSelect.innerHTML = sets
    .map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.selectedSetKey ? "selected" : ""}>${escapeHtml(item.label || item.key)}</option>`)
    .join("");

  if (!el.setSelect.dataset.bound) {
    el.setSelect.addEventListener("change", () => {
      if (el.setSelect.value && el.setSelect.value !== state.selectedSetKey) {
        navigateToSet(el.setSelect.value);
      }
    });
    el.setSelect.dataset.bound = "true";
  }
}

function navigateToSet(setKey) {
  const url = new URL(window.location.href);
  url.searchParams.delete("config");
  url.searchParams.delete("state");
  if (state.manifestUrl && state.manifestUrl !== resolveUrl(window.location.href, APP_DEFAULTS.set_manifest)) {
    url.searchParams.set("manifest", state.manifestUrl);
  } else {
    url.searchParams.delete("manifest");
  }
  url.searchParams.set("set", setKey);
  window.location.href = url.toString();
}
function renderDrawerProject(project, mode = "edit") {
  const identity = project.identity_and_role;
  const flows = project.interfaces_and_flows;
  const scheduler = project.scheduler;
  const roadmap = project.roadmap_and_tasks;
  const exportCommit = project.export_and_commit;
  const overview = getGlobalOverview();
  const overviewSteps = overview.next_steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const apiCards = flows.external_apis.length ? flows.external_apis.map((api) => formatApiCard(api)).join("") : `<div class="empty-note">No external APIs configured yet.</div>`;
  const taskSummaryCards = roadmap.length ? roadmap.map((task) => formatTaskSummary(task)).join("") : `<div class="empty-note">No roadmap items yet.</div>`;
  const docEntries = getDocEntries();
  const selectedDocPath = getSelectedDocPath();
  const selectedDoc = docEntries.find((doc) => doc.path === selectedDocPath) || docEntries[0] || { path: selectedDocPath, label: selectedDocPath, description: "" };
  const docSourceText = getDocSourceText(selectedDocPath);
  const docList = docEntries
    .map(
      (doc) => `
        <button class="doc-list-item${doc.path === selectedDocPath ? " active" : ""}" type="button" data-doc-select="${escapeHtml(doc.path)}">
          <strong>${escapeHtml(doc.label)}</strong>
          <span>${escapeHtml(doc.path)}</span>
        </button>
      `,
    )
    .join("");
  const taskRows = roadmap
    .map(
      (task, index) => `
        <div class="task-row">
          <div class="field">
            <label>Title</label>
            <input data-task-field="title" data-task-index="${index}" value="${escapeHtml(task.title)}" />
          </div>
          <div class="field">
            <label>Status</label>
            <select data-task-field="status" data-task-index="${index}">
              ${["planned", "in_progress", "done", "blocked"].map((option) => `<option value="${option}" ${option === task.status ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Priority</label>
            <select data-task-field="priority" data-task-index="${index}">
              ${["low", "medium", "high", "urgent"].map((option) => `<option value="${option}" ${option === task.priority ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </div>
          <div class="show-meta">
            <label class="checkbox-row"><input type="checkbox" data-task-field="show_in_meta" data-task-index="${index}" ${task.show_in_meta ? "checked" : ""} /> show_in_meta</label>
            <button class="inline-button" type="button" data-action="remove-task" data-task-index="${index}">Remove</button>
          </div>
        </div>
      `,
    )
    .join("");

  el.drawerBody.innerHTML = `
    <section class="section-card section-card--overview active" data-section="overview">
      <div class="overview-top">
        <div>
          <div class="panel-kicker">Project Overview</div>
          <h3>Whole-project status</h3>
        </div>
        <div class="overview-status" data-health="${escapeHtml(overview.status)}">${escapeHtml(overview.status)}</div>
      </div>
      <p class="overview-summary">${escapeHtml(overview.summary)}</p>
      <div class="overview-grid">
        <div>
          <div class="overview-label">Document</div>
          <a class="doc-link" href="${escapeHtml(overview.document_url)}" target="_blank" rel="noreferrer">${escapeHtml(overview.document_url)}</a>
          <div style="margin-top: 8px;">
            <button class="inline-button" type="button" data-doc-action="open-overview">Edit document</button>
          </div>
        </div>
        <div>
          <div class="overview-label">Next steps</div>
          <ul class="overview-steps">${overviewSteps}</ul>
        </div>
      </div>
    </section>

    <section class="section-card" data-section="docs">
      <div class="docs-shell">
        <div class="docs-sidebar">
          <div class="docs-header-row">
            <div>
              <div class="panel-kicker">Markdown docs</div>
              <h3>All project documents</h3>
            </div>
            <button class="inline-button" type="button" data-doc-action="connect-folder">Connect folder</button>
          </div>
          <div class="docs-note">Choose any MD file, edit it here, and save it back to disk when a writable folder is connected.</div>
          <div class="docs-list">${docList}</div>
        </div>
        <div class="docs-editor">
          <div class="form-grid">
            <div class="field full">
              <label>Document path</label>
              <input value="${escapeHtml(selectedDoc.path)}" readonly />
            </div>
            <div class="field full">
              <label>Title</label>
              <input value="${escapeHtml(selectedDoc.label)}" readonly />
            </div>
            <div class="field full">
              <label>Markdown</label>
              <textarea class="doc-editor" data-doc-editor="content">${escapeHtml(docSourceText)}</textarea>
            </div>
          </div>
          <div class="doc-actions">
            <button class="inline-button" type="button" data-doc-action="reload">Reload</button>
            <button class="primary" type="button" data-doc-action="save">Save document</button>
            <button class="ghost" type="button" data-doc-action="download">Download</button>
          </div>
        </div>
      </div>
    </section>

    <section class="section-card active" data-section="identity_and_role">
      <div class="form-grid">
        <div class="field">
          <label>Project ID</label>
          <input data-path="identity_and_role.project_id" value="${escapeHtml(identity.project_id)}" ${mode === "edit" ? "readonly" : ""} />
        </div>
        <div class="field">
          <label>Name</label>
          <input data-path="identity_and_role.name" value="${escapeHtml(identity.name)}" />
        </div>
        <div class="field full">
          <label>Description</label>
          <textarea data-path="identity_and_role.description">${escapeHtml(identity.description)}</textarea>
        </div>
        <div class="field full">
          <label>Role</label>
          <textarea data-path="identity_and_role.role">${escapeHtml(identity.role)}</textarea>
        </div>
        <div class="field">
          <label>Operational Status</label>
          <select data-path="identity_and_role.operational_status">
            ${["active", "idle", "error"].map((option) => `<option value="${option}" ${option === identity.operational_status ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        ${mode === "new" ? `
        <div class="field">
          <label>Node Type</label>
          <select data-draft-field="node_type">
            ${["project", "agent", "external_system"].map((option) => `<option value="${option}" ${option === state.draftNodeType ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        ` : ""}
      </div>
    </section>

    <section class="section-card" data-section="interfaces_and_flows">
      <div class="form-grid">
        <div class="field full">
          <label>Inputs, one per line</label>
          <textarea data-path="interfaces_and_flows.inputs_text">${escapeHtml(arrayToText(flows.inputs.map((input) => JSON.stringify(input))))}</textarea>
        </div>
        <div class="field full">
          <label>Outputs, one per line</label>
          <textarea data-path="interfaces_and_flows.outputs_text">${escapeHtml(arrayToText(flows.outputs.map((output) => JSON.stringify(output))))}</textarea>
        </div>
        <div class="field full">
          <label>External APIs, one per line</label>
          <textarea data-path="interfaces_and_flows.external_apis_text">${escapeHtml(arrayToText(flows.external_apis.map((api) => JSON.stringify(api))))}</textarea>
        </div>
      </div>
      <div class="array-note">Tip: each line accepts JSON objects for fast import/export.</div>
      <div class="api-list">${apiCards}</div>
    </section>

    <section class="section-card" data-section="scheduler">
      <div class="form-grid">
        <div class="field">
          <label>Cron Expression</label>
          <input data-path="scheduler.cron_expression" value="${escapeHtml(scheduler.cron_expression ?? "")}" placeholder="0 */4 * * *" />
        </div>
        <div class="field">
          <label>Next Run UTC</label>
          <input data-path="scheduler.next_run_utc" value="${escapeHtml(scheduler.next_run_utc ?? "")}" placeholder="2026-08-21T12:00:00Z" />
        </div>
        <div class="field">
          <label>Execution Type</label>
          <select data-path="scheduler.execution_type">
            ${["automated_api", "local_worker", "manual_run", "not_scheduled"].map((option) => `<option value="${option}" ${option === scheduler.execution_type ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Timezone</label>
          <input data-path="scheduler.timezone" value="${escapeHtml(scheduler.timezone ?? "UTC")}" />
        </div>
        <label class="checkbox-row"><input type="checkbox" data-path="scheduler.requires_manual_login" ${scheduler.requires_manual_login ? "checked" : ""} /> requires_manual_login</label>
      </div>
    </section>

    <section class="section-card" data-section="roadmap_and_tasks">
      <div class="array-note">Inline task editing: status, priority, title, and show_in_meta.</div>
      <div class="task-summary">${taskSummaryCards}</div>
      <div class="task-list" id="taskList">${taskRows}</div>
      <div style="margin-top: 10px;">
        <button class="inline-button" type="button" id="addTaskButton">Add Task</button>
      </div>
    </section>

    <section class="section-card" data-section="export_and_commit">
      <div class="form-grid">
        <div class="field full">
          <label>Commit Message Template</label>
          <textarea data-path="export_and_commit.commit_message_template">${escapeHtml(exportCommit.commit_message_template ?? "")}</textarea>
        </div>
        <div class="field full">
          <label>Patch Protocol</label>
          <input data-path="export_and_commit.patch_protocol" value="${escapeHtml(exportCommit.patch_protocol || "json_patch_rfc6902")}" readonly />
        </div>
      </div>
      <div class="array-note">Save writes a revisioned snapshot to local storage and exports JSON files.</div>
    </section>
  `;

  selectSection(state.activeSection);
  wireDrawerInputs();
}

function renderDrawerEdge(edge) {
  el.drawerBody.innerHTML = `
    <section class="section-card active" data-section="identity_and_role">
      <div class="form-grid">
        <div class="field">
          <label>Edge ID</label>
          <input value="${escapeHtml(edge.edge_id)}" readonly />
        </div>
        <div class="field">
          <label>Label</label>
          <input data-edge-path="label" value="${escapeHtml(edge.label)}" />
        </div>
        <div class="field">
          <label>Source Node</label>
          <input data-edge-path="source_node" value="${escapeHtml(edge.source_node)}" />
        </div>
        <div class="field">
          <label>Target Node</label>
          <input data-edge-path="target_node" value="${escapeHtml(edge.target_node)}" />
        </div>
        <div class="field">
          <label>Channel Type</label>
          <select data-edge-path="channel_type">
            ${["direct_push", "queue", "webhook", "polling", "manual_upload", "scheduled_pull"].map((option) => `<option value="${option}" ${option === edge.channel_type ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Payload Format</label>
          <select data-edge-path="payload_format">
            ${["CSV", "JSON", "HTML", "PDF", "TXT", "REST_JSON", "EMAIL", "MIXED"].map((option) => `<option value="${option}" ${option === edge.payload_format ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Protocol</label>
          <select data-edge-path="protocol">
            ${["imap", "smtp", "rest", "filesystem", "database", "queue", "webhook", "manual", "internal"].map((option) => `<option value="${option}" ${option === edge.protocol ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select data-edge-path="status">
            ${["healthy", "degraded", "blocked", "unknown"].map((option) => `<option value="${option}" ${option === edge.status ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </div>
        <div class="field full">
          <label>Last Success UTC</label>
          <input data-edge-path="last_success_at_utc" value="${escapeHtml(edge.last_success_at_utc || "")}" placeholder="2026-08-21T06:00:00Z" />
        </div>
      </div>
    </section>
  `;
  el.drawerTabs.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.section === "identity_and_role"));
  wireDrawerInputs();
}

function renderDrawer() {
  if (!state.draft) return;
  if (state.draftKind === "project-new") {
    el.drawerMode.textContent = "Fast Project";
    el.drawerTitle.textContent = "Create Project / Agent";
  } else if (state.draftKind === "project") {
    el.drawerMode.textContent = "Project";
    el.drawerTitle.textContent = state.draft.identity_and_role.name || state.draft.identity_and_role.project_id;
  } else if (state.draftKind === "edge") {
    el.drawerMode.textContent = "Edge Inspector";
    el.drawerTitle.textContent = state.draft.label || state.draft.edge_id;
  }

  el.drawerRevision.textContent = `rev ${state.server.state.revision}`;
  el.drawerBaseRevision.textContent = `base ${state.baseRevision}`;

  if (state.draftKind === "edge") {
    renderDrawerEdge(state.draft);
    return;
  }
  renderDrawerProject(state.draft, state.draftKind === "project-new" ? "new" : "edit");
}

function wireDrawerInputs() {
  el.drawerBody.querySelectorAll("[data-path]").forEach((input) => {
    const isCheckbox = input.type === "checkbox";
    const eventName = isCheckbox ? "change" : "input";
    input.addEventListener(eventName, () => {
      const path = input.dataset.path;
      const value = isCheckbox ? input.checked : input.value;
      updateDraftField(path, value);
    });
  });

  el.drawerBody.querySelectorAll("[data-edge-path]").forEach((input) => {
    const eventName = input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, () => {
      updateDraftField(`edge.${input.dataset.edgePath}`, input.type === "checkbox" ? input.checked : input.value);
    });
  });

  el.drawerBody.querySelectorAll("[data-draft-field]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.dataset.draftField === "node_type") {
        state.draftNodeType = input.value;
        updatePatchPreview();
      }
    });
  });

  el.drawerBody.querySelectorAll("[data-doc-select]").forEach((button) => {
    button.addEventListener("click", () => setSelectedDocPath(button.dataset.docSelect));
  });

  const docEditor = el.drawerBody.querySelector("[data-doc-editor]");
  if (docEditor) {
    docEditor.addEventListener("input", () => {
      state.docDraft = docEditor.value;
    });
  }

  el.drawerBody.querySelectorAll("[data-doc-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.docAction;
      if (action === "connect-folder") {
        await connectDocsFolder();
      } else if (action === "open-overview") {
        const path = state.docsManifest?.default_doc || "docs/project-overview.md";
        setSelectedDocPath(path);
      } else if (action === "reload") {
        const path = getSelectedDocPath();
        state.docDraft = state.docsContentByPath[path] || "";
        renderDrawer();
      } else if (action === "save") {
        await saveActiveDoc();
      } else if (action === "download") {
        const path = getSelectedDocPath();
        const content = state.docDraft ?? "";
        const blob = new Blob([content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() || "document.md";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    });
  });

  el.drawerBody.querySelectorAll("[data-task-field]").forEach((input) => {
    const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => {
      const index = Number(input.dataset.taskIndex);
      const field = input.dataset.taskField;
      const task = state.draft.roadmap_and_tasks[index];
      if (!task) return;
      task[field] = input.type === "checkbox" ? input.checked : input.value;
      state.draft = clone(state.draft);
      updatePatchPreview();
    });
  });

  const addTaskButton = document.getElementById("addTaskButton");
  if (addTaskButton) {
    addTaskButton.addEventListener("click", () => {
      state.draft.roadmap_and_tasks.push({
        task_id: uuid("task"),
        title: "",
        type: "roadmap_task",
        status: "planned",
        priority: "medium",
        show_in_meta: false,
        blocked_reason: null,
        due_at_utc: null,
      });
      state.draft = clone(state.draft);
      renderDrawer();
      updatePatchPreview();
    });
  }

  el.drawerBody.querySelectorAll("[data-action='remove-task']").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.taskIndex);
      state.draft.roadmap_and_tasks.splice(index, 1);
      state.draft = clone(state.draft);
      renderDrawer();
      updatePatchPreview();
    });
  });
}

function updateDraftField(path, value) {
  if (!state.draft) return;
  if (state.draftKind === "edge") {
    const key = path.replace(/^edge\./, "");
    state.draft[key] = key === "last_success_at_utc" ? (value || null) : value;
    state.draft = clone(state.draft);
    updatePatchPreview();
    return;
  }

  const parts = path.split(".");
  let cursor = state.draft;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor = cursor[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (path === "scheduler.requires_manual_login") {
    cursor[last] = Boolean(value);
  } else if (path === "scheduler.next_run_utc") {
    cursor[last] = value || null;
  } else if (path === "scheduler.cron_expression") {
    cursor[last] = value || null;
  } else if (path === "interfaces_and_flows.inputs_text") {
    cursor.inputs = parseJsonLines(value);
  } else if (path === "interfaces_and_flows.outputs_text") {
    cursor.outputs = parseJsonLines(value);
  } else if (path === "interfaces_and_flows.external_apis_text") {
    cursor.external_apis = parseJsonLines(value);
  } else if (path === "export_and_commit.last_patch") {
    cursor[last] = value;
  } else {
    cursor[last] = value;
  }
  state.draft = clone(state.draft);
  updatePatchPreview();
}

function parseJsonLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return line;
    }
  });
}

function stringifyJsonLines(items) {
  return items.map((item) => (typeof item === "string" ? item : JSON.stringify(item, null, 0))).join("\n");
}

function diffValues(before, after, path, ops) {
  if (before === after) return;
  const beforeType = Array.isArray(before) ? "array" : typeof before;
  const afterType = Array.isArray(after) ? "array" : typeof after;
  if (before === null || after === null || beforeType !== afterType) {
    ops.push({ op: before === undefined ? "add" : "replace", path, value: clone(after) });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      ops.push({ op: "replace", path, value: clone(after) });
      return;
    }
    for (let i = 0; i < before.length; i++) {
      diffValues(before[i], after[i], `${path}/${i}`, ops);
    }
    return;
  }

  if (beforeType === "object" && afterType === "object") {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const key of keys) {
      if (!(key in after)) {
        ops.push({ op: "remove", path: `${path}/${escapePointer(key)}` });
        continue;
      }
      if (!(key in before)) {
        ops.push({ op: "add", path: `${path}/${escapePointer(key)}`, value: clone(after[key]) });
        continue;
      }
      diffValues(before[key], after[key], `${path}/${escapePointer(key)}`, ops);
    }
    return;
  }

  ops.push({ op: before === undefined ? "add" : "replace", path, value: clone(after) });
}

function escapePointer(segment) {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function diffProject(originalProject, draftProject, projectIndex) {
  const ops = [];
  diffValues(originalProject, draftProject, `/projects/${projectIndex}`, ops);
  return ops;
}

function diffEdge(originalEdge, draftEdge, edgeIndex) {
  const ops = [];
  diffValues(originalEdge, draftEdge, `/meta_window/graph/edges/${edgeIndex}`, ops);
  return ops;
}

function buildPatchPreview() {
  if (!state.draft) return [];
  if (state.draftKind === "edge") {
    const index = findEdgeIndex(state.draft.edge_id);
    if (index < 0) return [];
    return diffEdge(state.original, state.draft, index);
  }

  if (state.draftKind === "project-new") {
    return [
      { op: "add", path: "/projects/-", value: clone(state.draft) },
      { op: "add", path: "/meta_window/graph/nodes/-", value: createProjectNodeFromProject(state.draft, state.draftNodeType) },
    ];
  }

  const index = findProjectIndex(state.original.identity_and_role.project_id);
  const nodeIndex = findNodeIndex(state.original.identity_and_role.project_id);
  const ops = diffProject(state.original, state.draft, index);
  const nodeAfter = createProjectNodeFromProject(state.draft, state.server.meta_window.graph.nodes[nodeIndex]?.node_type || "project");
  const nodeBefore = clone(state.server.meta_window.graph.nodes[nodeIndex]);
  if (nodeIndex >= 0) {
    diffValues(nodeBefore, nodeAfter, `/meta_window/graph/nodes/${nodeIndex}`, ops);
  }
  return ops;
}

function applyPatchOps(candidate, ops) {
  const next = clone(candidate);
  for (const op of ops) {
    applySingleOp(next, op);
  }
  return next;
}

function applySingleOp(root, op) {
  const segments = op.path.split("/").slice(1).map(unescapePointer);
  const parent = segments.slice(0, -1).reduce((acc, key) => acc[key], root);
  const key = segments[segments.length - 1];
  if (op.op === "add") {
    if (Array.isArray(parent)) {
      if (key === "-") parent.push(clone(op.value));
      else parent.splice(Number(key), 0, clone(op.value));
    } else {
      parent[key] = clone(op.value);
    }
    return;
  }
  if (op.op === "replace") {
    if (Array.isArray(parent)) parent[Number(key)] = clone(op.value);
    else parent[key] = clone(op.value);
    return;
  }
  if (op.op === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
    return;
  }
  throw new Error(`Unsupported op: ${op.op}`);
}

function unescapePointer(segment) {
  return String(segment).replaceAll("~1", "/").replaceAll("~0", "~");
}

function updatePatchPreview() {
  if (!state.draft) return;
  const ops = buildPatchPreview();
  el.patchPreview.textContent = JSON.stringify(ops, null, 2);
  const preview = draftValidationErrors();
  if (preview.length) {
    setSummary(preview.join(" "), "warn");
  } else {
    setSummary(`Ready to save ${ops.length} patch operation(s).`, "ok");
  }
}

function draftValidationErrors() {
  const errors = [];
  if (state.draftKind === "edge") {
    const edge = state.draft;
    if (!edge.label) errors.push("Edge label is required.");
    if (!edge.source_node) errors.push("Edge source_node is required.");
    if (!edge.target_node) errors.push("Edge target_node is required.");
    return errors;
  }
  const project = state.draft;
  if (!project.identity_and_role.project_id) errors.push("project_id is required.");
  if (!project.identity_and_role.name) errors.push("name is required.");
  if (!["active", "idle", "error"].includes(project.identity_and_role.operational_status)) errors.push("operational_status is invalid.");
  return errors;
}

function getGlobalOverview() {
  const fallbackSteps = [
    "Keep the financial ingestion chain healthy: Isracard Mail → Mail Manager → Economic Manager.",
    "Keep the Compass hub balanced across finance and non-finance subprojects.",
    "Open any project or edge to update its roadmap, APIs, and commit template.",
  ];
  const overview = state.server?.meta_window?.overview || {};
  return {
    status: overview.status || state.server?.meta_window?.health?.status || "unknown",
    summary:
      overview.summary ||
      "Compass is the active hub for both financial and non-financial subprojects. Use the drawer to update project details, APIs, roadmap items, and commit instructions.",
    next_steps: Array.isArray(overview.next_steps) && overview.next_steps.length ? overview.next_steps : fallbackSteps,
    document_url: overview.document_url || "docs/project-overview.md",
  };
}

function formatApiCard(api) {
  const name = api.endpoint_name || api.name || "API";
  const trigger = api.trigger_mode ? `trigger: ${api.trigger_mode}` : null;
  const auth = api.auth_requirements ? `auth: ${api.auth_requirements}` : null;
  const base = api.base_url ? `base: ${api.base_url}` : null;
  const rate = api.rate_limit ? `rate: ${api.rate_limit}` : null;
  return `
    <div class="api-card">
      <strong>${escapeHtml(name)}</strong>
      <div class="api-card__meta">${[base, trigger, auth, rate].filter(Boolean).map(escapeHtml).join(" · ") || "No details provided."}</div>
    </div>
  `;
}

function formatTaskSummary(task) {
  const extras = [task.priority, task.due_at_utc ? `due ${task.due_at_utc}` : null, task.blocked_reason ? `blocked: ${task.blocked_reason}` : null].filter(Boolean).join(" · ");
  return `
    <div class="task-summary-item task-summary-item--${escapeHtml(task.status || "planned")}">
      <strong>${escapeHtml(task.title)}</strong>
      <div>${escapeHtml(extras || task.status || "planned")}</div>
    </div>
  `;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.text();
}

function normalizeDocsManifest(raw) {
  return {
    default_doc: raw?.default_doc || "docs/project-overview.md",
    docs: Array.isArray(raw?.docs)
      ? raw.docs
          .filter((item) => item && item.path)
          .map((item) => ({
            path: item.path,
            label: item.label || item.path.split("/").pop() || item.path,
            description: item.description || "",
          }))
      : [],
  };
}

function getDocEntries() {
  const docs = state.docsManifest?.docs || [];
  if (docs.length) return docs;
  return [
    { path: "README.md", label: "README", description: "Root project overview" },
    { path: "docs/project-overview.md", label: "Project Overview", description: "Compass status and next steps" },
    { path: "docs/hermes-component-api-spec.md", label: "Hermes Component API Spec", description: "API and state spec" },
  ];
}

function getSelectedDocPath() {
  const docs = getDocEntries();
  return state.selectedDocPath || state.docsManifest?.default_doc || docs[0]?.path || "";
}

function setSelectedDocPath(path) {
  state.selectedDocPath = path;
  state.docDraft = state.docsContentByPath[path] ?? state.docDraft ?? "";
  state.activeSection = "docs";
  renderDrawer();
}

function getDocSourceText(path) {
  return path === state.selectedDocPath ? state.docDraft : state.docsContentByPath[path] || "";
}

async function loadDocsManifest(baseUrl, docsManifestUrl) {
  const resolved = resolveUrl(baseUrl, docsManifestUrl || "docs/index.json");
  try {
    return { url: resolved, manifest: normalizeDocsManifest(await fetchJson(resolved)) };
  } catch {
    return { url: resolved, manifest: normalizeDocsManifest({}) };
  }
}

async function loadDocsContent(baseUrl, docsManifest) {
  const entries = docsManifest.docs.length ? docsManifest.docs : getDocEntries();
  const contentByPath = {};
  for (const entry of entries) {
    const url = resolveUrl(baseUrl, entry.path);
    try {
      contentByPath[entry.path] = await fetchText(url);
    } catch {
      contentByPath[entry.path] = `# Missing file\n\nUnable to load ${entry.path}`;
    }
  }
  state.docsContentByPath = contentByPath;
  if (!state.selectedDocPath) state.selectedDocPath = docsManifest.default_doc || entries[0]?.path || "";
  if (!state.docDraft) state.docDraft = contentByPath[state.selectedDocPath] || "";
}

function getActiveDocEntry() {
  const path = getSelectedDocPath();
  return getDocEntries().find((doc) => doc.path === path) || { path, label: path, description: "" };
}

async function connectDocsFolder() {
  if (!window.showDirectoryPicker) {
    setSummary("This browser does not support folder write access. Use download fallback or Chrome.", "warn");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.docsFolderHandle = handle;
    state.docsFileHandles = {};
    await indexDocsFolder(handle);
    setSummary("Docs folder connected. You can now save Markdown directly to disk.", "ok");
  } catch (error) {
    if (error?.name !== "AbortError") setSummary(error.message, "error");
  }
}

async function indexDocsFolder(dirHandle, basePath = "") {
  for await (const [name, handle] of dirHandle.entries()) {
    const relPath = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      await indexDocsFolder(handle, relPath);
      continue;
    }
    if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
      state.docsFileHandles[relPath] = handle;
      const file = await handle.getFile();
      state.docsContentByPath[relPath] = await file.text();
    }
  }
}

async function saveActiveDoc() {
  const path = getSelectedDocPath();
  if (!path) return;
  const content = state.docDraft ?? "";
  const handle = state.docsFileHandles[path];
  if (handle?.createWritable) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    state.docsContentByPath[path] = content;
    setSummary(`Saved ${path} to disk.`, "ok");
    return;
  }
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "document.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  state.docsContentByPath[path] = content;
  setSummary(`Downloaded ${path} because no writable folder is connected.`, "warn");
}

function openProjectDrawer(projectId) {
  const index = findProjectIndex(projectId);
  if (index < 0) return;
  state.selectedNodeId = projectId;
  state.selectedEdgeId = null;
  state.draftKind = "project";
  state.activeSection = "identity_and_role";
  state.original = clone(state.server.projects[index]);
  state.draft = clone(state.server.projects[index]);
  state.baseRevision = state.server.state.revision;
  renderDrawer();
  updatePatchPreview();
  setDrawerOpen(true);
  render();
}

function openNewProjectDrawer() {
  const empty = createEmptyProject({ project_id: "", name: "", description: "", role: "", node_type: "project", status: "idle" });
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.draftKind = "project-new";
  state.activeSection = "identity_and_role";
  state.draftNodeType = "project";
  state.original = null;
  state.draft = empty.project;

  state.draft.roadmap_and_tasks = [];
  state.baseRevision = state.server.state.revision;
  renderDrawer();
  updatePatchPreview();
  setDrawerOpen(true);
}

function openEdgeDrawer(edgeId) {
  const index = findEdgeIndex(edgeId);
  if (index < 0) return;
  state.selectedNodeId = null;
  state.selectedEdgeId = edgeId;
  state.draftKind = "edge";
  state.original = clone(state.server.meta_window.graph.edges[index]);
  state.draft = clone(state.original);
  state.baseRevision = state.server.state.revision;
  renderDrawer();
  updatePatchPreview();
  setDrawerOpen(true);
  render();
}

function closeDrawer() {
  setDrawerOpen(false);
}

function getNodeColor(node) {
  if (node.node_type === "external_system") return getComputedStyle(document.documentElement).getPropertyValue("--external").trim();
  if (node.node_type === "agent") return getComputedStyle(document.documentElement).getPropertyValue("--agent").trim();
  if (node.status === "error") return getComputedStyle(document.documentElement).getPropertyValue("--bad").trim();
  if (node.status === "idle") return getComputedStyle(document.documentElement).getPropertyValue("--warn").trim();
  return getComputedStyle(document.documentElement).getPropertyValue("--project").trim();
}

function ensureGraphDimensions(viewportEl) {
  const rect = viewportEl.getBoundingClientRect();
  return {
    width: Math.max(rect.width, 320),
    height: Math.max(rect.height, 320),
  };
}

function getGraphData() {
  return {
    nodes: state.server.meta_window.graph.nodes.map(normalizeNode),
    links: state.server.meta_window.graph.edges.map(normalizeEdge),
  };
}

function renderNetworkGraph() {
  if (!state.server || !el.graphSvg || !el.graphViewport) return;
  const { width, height } = ensureGraphDimensions(el.graphViewport);
  const { nodes, links } = getGraphData();
  const simulationLinks = links.map((link) => ({ ...link, source: link.source_node, target: link.target_node }));
  const svg = d3.select(el.graphSvg);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const root = svg.append("g").attr("class", "graph-root");
  const zoomLayer = root.append("g").attr("class", "zoom-layer");

  const zoom = d3.zoom().scaleExtent([0.35, 2.5]).on("zoom", (event) => {
    zoomLayer.attr("transform", event.transform);
  });
  svg.call(zoom).on("dblclick.zoom", null);

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 15)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "rgba(148, 163, 184, 0.8)");

  const linkGroup = zoomLayer.append("g").attr("class", "links").selectAll("g").data(simulationLinks, (d) => d.edge_id).join("g").attr("class", (d) => `edge-group${state.selectedEdgeId === d.edge_id ? " selected" : ""}`);

  linkGroup
    .append("line")
    .attr("class", "link-line")
    .attr("marker-end", "url(#arrowhead)");

  linkGroup
    .append("line")
    .attr("class", "link-hit")
    .on("click", (event, d) => {
      event.stopPropagation();
      openEdgeDrawer(d.edge_id);
    })
    .on("mouseenter", (event, d) => showEdgeTooltip(event, d, el.graphViewport, el.tooltip))
    .on("mousemove", (event, d) => showEdgeTooltip(event, d, el.graphViewport, el.tooltip))
    .on("mouseleave", () => hideTooltip(el.tooltip));

  linkGroup
    .append("text")
    .attr("class", "edge-badge")
    .text((d) => d.label);

  const nodeGroup = zoomLayer.append("g").attr("class", "nodes").selectAll("g").data(nodes, (d) => d.node_id).join("g").attr("class", (d) => `node${state.selectedNodeId === d.node_id ? " selected" : ""}`);

  nodeGroup
    .append("circle")
    .attr("r", (d) => (d.node_type === "external_system" ? 16 : d.node_type === "agent" ? 18 : 22))
    .attr("fill", (d) => getNodeColor(d))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.project_ref) openProjectDrawer(d.project_ref);
    })
    .on("mouseenter", (event, d) => showNodeTooltip(event, d, el.graphViewport, el.tooltip))
    .on("mousemove", (event, d) => showNodeTooltip(event, d, el.graphViewport, el.tooltip))
    .on("mouseleave", () => hideTooltip(el.tooltip))
    .call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) state.simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) state.simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  nodeGroup
    .append("text")
    .attr("dy", 34)
    .text((d) => d.label);

  state.simulation?.stop?.();
  state.simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(simulationLinks).id((d) => d.node_id).distance(120).strength(0.75))
    .force("charge", d3.forceManyBody().strength(-360))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((d) => (d.node_type === "external_system" ? 36 : d.node_type === "agent" ? 40 : 48)))
    .on("tick", ticked);

  function ticked() {
    linkGroup
      .select("line.link-line")
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    linkGroup
      .select("line.link-hit")
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    linkGroup
      .select("text.edge-badge")
      .attr("x", (d) => (d.source.x + d.target.x) / 2)
      .attr("y", (d) => (d.source.y + d.target.y) / 2 - 6)
      .attr("text-anchor", "middle");

    nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  root.on("click", () => {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    hideTooltip(el.tooltip);
    renderNetworkGraph();
  });

  state.graphReady = true;
}

function compassPosition(node, index, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = Math.min(width, height) * 0.28;
  const manualAngles = {
    isracard_mail: (200 * Math.PI) / 180,
    mail_manager: (150 * Math.PI) / 180,
    economic_manager: (235 * Math.PI) / 180,
    self_manager: (325 * Math.PI) / 180,
    assessment: (20 * Math.PI) / 180,
    administrative: (110 * Math.PI) / 180,
  };
  const manualRadiusScale = {
    isracard_mail: 1.02,
    mail_manager: 0.98,
    economic_manager: 1.0,
    self_manager: 0.98,
    assessment: 0.96,
    administrative: 0.98,
  };

  if (node.node_id === "compass") {
    return { x: cx, y: cy, cx, cy, radius: 0, angle: 0 };
  }

  const hash = [...String(node.node_id)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const isManual = Object.prototype.hasOwnProperty.call(manualAngles, node.node_id);
  const angle = isManual ? manualAngles[node.node_id] : (hash % 360) * (Math.PI / 180);
  const statusScale = node.status === "error" ? 1.18 : node.status === "idle" ? 1.02 : 0.88;
  const typeScale = node.node_type === "external_system" ? 0.95 : node.node_type === "agent" ? 1.02 : 1;
  const radius = baseRadius * statusScale * typeScale * (isManual ? manualRadiusScale[node.node_id] : 1) + (isManual ? 0 : (index % 4) * 16);
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
    cx,
    cy,
    radius,
    angle,
  };
}

function renderCompassGraph() {
  if (!state.server || !el.compassSvg || !el.compassViewport) return;
  const { width, height } = ensureGraphDimensions(el.compassViewport);
  const { nodes, links } = getGraphData();
  const layoutNodes = nodes.map((node, index) => ({ ...node, ...compassPosition(node, index, width, height) }));
  layoutNodes.forEach((node) => {
    node.fx = node.x;
    node.fy = node.y;
  });
  const layoutMap = new Map(layoutNodes.map((node) => [node.node_id, node]));
  const layoutLinks = links
    .map((link) => ({ ...link, source: layoutMap.get(link.source_node), target: layoutMap.get(link.target_node) }))
    .filter((link) => link.source && link.target);

  const svg = d3.select(el.compassSvg);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const root = svg.append("g").attr("class", "graph-root compass-root");
  const layer = root.append("g").attr("class", "compass-layer");
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.34;

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "compass-arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 15)
    .attr("refY", 0)
    .attr("markerWidth", 5)
    .attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "rgba(148, 163, 184, 0.55)");

  layer.append("circle").attr("class", "compass-ring compass-ring--outer").attr("cx", cx).attr("cy", cy).attr("r", maxRadius).attr("fill", "none");
  layer.append("circle").attr("class", "compass-ring compass-ring--mid").attr("cx", cx).attr("cy", cy).attr("r", maxRadius * 0.68).attr("fill", "none");
  layer.append("circle").attr("class", "compass-ring compass-ring--inner").attr("cx", cx).attr("cy", cy).attr("r", maxRadius * 0.36).attr("fill", "none");
  layer.append("line").attr("class", "compass-axis").attr("x1", cx).attr("y1", 24).attr("x2", cx).attr("y2", height - 24);
  layer.append("line").attr("class", "compass-axis").attr("x1", 24).attr("y1", cy).attr("x2", width - 24).attr("y2", cy);
  layer.append("text").attr("class", "compass-label").attr("x", cx).attr("y", 20).attr("text-anchor", "middle").text("N");
  layer.append("text").attr("class", "compass-label").attr("x", width - 16).attr("y", cy + 4).attr("text-anchor", "end").text("E");
  layer.append("text").attr("class", "compass-label").attr("x", cx).attr("y", height - 10).attr("text-anchor", "middle").text("S");
  layer.append("text").attr("class", "compass-label").attr("x", 16).attr("y", cy + 4).attr("text-anchor", "start").text("W");
  const compassParts = [
    { id: "isracard_mail", label: "Isracard Mail", angle: (200 * Math.PI) / 180, r: maxRadius * 1.02 },
    { id: "mail_manager", label: "Mail Manager", angle: (150 * Math.PI) / 180, r: maxRadius * 1.02 },
    { id: "economic_manager", label: "Economic Manager", angle: (235 * Math.PI) / 180, r: maxRadius * 1.02 },
    { id: "self_manager", label: "Self Manager", angle: (325 * Math.PI) / 180, r: maxRadius * 1.02 },
    { id: "assessment", label: "Assessment", angle: (20 * Math.PI) / 180, r: maxRadius * 1.02 },
    { id: "administrative", label: "Administrative", angle: (110 * Math.PI) / 180, r: maxRadius * 1.02 },
  ];
  const financeSummary = compassParts
    .filter((part) => ["isracard_mail", "mail_manager", "economic_manager"].includes(part.id) && layoutMap.has(part.id))
    .map((part) => part.label)
    .join(" • ");
  const nonFinanceSummary = compassParts
    .filter((part) => ["self_manager", "assessment", "administrative"].includes(part.id) && layoutMap.has(part.id))
    .map((part) => part.label)
    .join(" • ");

  layer
    .append("g")
    .attr("class", "compass-role-labels")
    .selectAll("g")
    .data(compassParts.filter((part) => layoutMap.has(part.id)))
    .join("g")
    .attr("class", "compass-role-label")
    .each(function (part) {
      const g = d3.select(this);
      const x = cx + Math.cos(part.angle) * part.r;
      const y = cy + Math.sin(part.angle) * part.r;
      g.append("line")
        .attr("class", "compass-role-line")
        .attr("x1", cx)
        .attr("y1", cy)
        .attr("x2", x)
        .attr("y2", y)
        .attr("stroke-dasharray", "6 6");
      g.append("circle").attr("class", "compass-role-dot").attr("cx", x).attr("cy", y).attr("r", 4);
      g.append("text")
        .attr("class", "compass-role-text")
        .attr("x", x)
        .attr("y", y - 10)
        .attr("text-anchor", Math.cos(part.angle) >= 0 ? "start" : "end")
        .text(part.label);
    });

  layer.append("text").attr("class", "compass-center-label").attr("x", cx).attr("y", cy - 12).attr("text-anchor", "middle").text("Compass");
  layer.append("text").attr("class", "compass-center-subtitle").attr("x", cx).attr("y", cy + 10).attr("text-anchor", "middle").text(`Finance: ${financeSummary}`);
  layer.append("text").attr("class", "compass-center-subtitle").attr("x", cx).attr("y", cy + 26).attr("text-anchor", "middle").text(`Non-finance: ${nonFinanceSummary}`);

  const edgeGroup = layer.append("g").attr("class", "compass-links").selectAll("g").data(layoutLinks, (d) => d.edge_id).join("g").attr("class", (d) => `edge-group${state.selectedEdgeId === d.edge_id ? " selected" : ""}`);
  edgeGroup
    .append("line")
    .attr("class", "link-line")
    .attr("stroke-dasharray", "4 4")
    .attr("marker-end", "url(#compass-arrowhead)");
  edgeGroup
    .append("line")
    .attr("class", "link-hit")
    .on("click", (event, d) => {
      event.stopPropagation();
      openEdgeDrawer(d.edge_id);
    })
    .on("mouseenter", (event, d) => showEdgeTooltip(event, d, el.compassViewport, el.compassTooltip))
    .on("mousemove", (event, d) => showEdgeTooltip(event, d, el.compassViewport, el.compassTooltip))
    .on("mouseleave", () => hideTooltip(el.compassTooltip));
  edgeGroup
    .append("text")
    .attr("class", "edge-badge")
    .text((d) => d.label);

  const nodeGroup = layer.append("g").attr("class", "compass-nodes").selectAll("g").data(layoutNodes, (d) => d.node_id).join("g").attr("class", (d) => `node node--compass${state.selectedNodeId === d.node_id ? " selected" : ""}`);
  nodeGroup
    .append("circle")
    .attr("r", (d) => (d.node_type === "project" ? 20 : d.node_type === "agent" ? 17 : 14))
    .attr("fill", (d) => getNodeColor(d))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.project_ref) openProjectDrawer(d.project_ref);
    })
    .on("mouseenter", (event, d) => showNodeTooltip(event, d, el.compassViewport, el.compassTooltip))
    .on("mousemove", (event, d) => showNodeTooltip(event, d, el.compassViewport, el.compassTooltip))
    .on("mouseleave", () => hideTooltip(el.compassTooltip));
  nodeGroup
    .append("text")
    .attr("dy", 32)
    .text((d) => d.label);
  nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);

  root.on("click", () => {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    hideTooltip(el.compassTooltip);
    renderCompassGraph();
  });
}

function showTooltip(viewportEl, tooltipEl, event, html) {
  const box = viewportEl.getBoundingClientRect();
  tooltipEl.hidden = false;
  tooltipEl.innerHTML = html;
  const x = Math.min(Math.max(event.clientX - box.left + 16, 10), box.width - 300);
  const y = Math.min(Math.max(event.clientY - box.top + 16, 10), box.height - 160);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function showNodeTooltip(event, node, viewportEl = el.graphViewport, tooltipEl = el.tooltip) {
  showTooltip(
    viewportEl,
    tooltipEl,
    event,
    `
      <strong>${escapeHtml(node.label)}</strong>
      <div>node_type: ${escapeHtml(node.node_type)}</div>
      <div>project_ref: ${escapeHtml(node.project_ref || "—")}</div>
      <div>status: ${escapeHtml(node.status)}</div>
    `,
  );
}

function showEdgeTooltip(event, edge, viewportEl = el.graphViewport, tooltipEl = el.tooltip) {
  showTooltip(
    viewportEl,
    tooltipEl,
    event,
    `
      <strong>${escapeHtml(edge.label)}</strong>
      <div>payload_format: ${escapeHtml(edge.payload_format)}</div>
      <div>protocol: ${escapeHtml(edge.protocol)}</div>
      <div>channel_type: ${escapeHtml(edge.channel_type)}</div>
      <div>status: ${escapeHtml(edge.status)}</div>
      <div>last_success_at_utc: ${escapeHtml(edge.last_success_at_utc || "—")}</div>
    `,
  );
}

function hideTooltip(tooltipEl = el.tooltip) {
  tooltipEl.hidden = true;
}

function updateServerHealth() {
  const health = state.server.meta_window.health;
  const alerts = state.server.meta_window.alerts || [];
  const tasks = getMetaTasks();
  state.server.meta_window.health.active_projects = state.server.projects.filter((project) => project.identity_and_role.operational_status === "active").length;
  state.server.meta_window.health.blocked_tasks = tasks.filter((task) => task.status === "blocked").length;
  state.server.meta_window.health.open_alerts = alerts.filter((alert) => alert.status === "open").length;
  state.server.meta_window.meta_tasks = tasks;
  state.server.meta_window.health.status = health.status || (state.server.meta_window.health.blocked_tasks ? "degraded" : "healthy");
}

function render() {
  if (!state.server) return;
  updateServerHealth();
  renderTopbar();
  renderCompassGraph();
  if (state.draft) {
    renderDrawer();
    updatePatchPreview();
  }
}

function persistServerState(server) {
  state.server = normalizeState(server);
  saveJsonToStorage(state.storageKey, state.server);
  render();
}

function exportSnapshot(server) {
  const payload = JSON.stringify(server, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${server.state.ecosystem_id}-rev-${String(server.state.revision).padStart(4, "0")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function saveCurrent() {
  const base = state.server;
  const currentPersisted = loadJsonFromStorage(state.storageKey);
  if (currentPersisted && currentPersisted.state && currentPersisted.state.revision !== state.baseRevision) {
    setSummary(
      `Revision conflict. Current ${currentPersisted.state.revision}, base ${state.baseRevision}. Paths: /state/revision`,
      "error",
    );
    state.server = normalizeState(currentPersisted);
    render();
    return;
  }

  const errors = draftValidationErrors();
  if (errors.length) {
    setSummary(errors.join(" "), "warn");
    return;
  }

  const patchOps = buildPatchPreview();
  let next = clone(base);
  try {
    next = applyPatchOps(next, patchOps);
  } catch (error) {
    setSummary(`Failed to apply patch: ${error.message}`, "error");
    return;
  }

  next.state.revision = (next.state.revision || 0) + 1;
  next.state.updated_at_utc = nowUtc();
  next.state.updated_by = "local-editor";
  next.state.lock ??= { mode: "optimistic", owner: null, expires_at_utc: null };
  next.exported_patch = patchOps;
  next.meta_window.meta_tasks = deriveMetaTasks(next.projects);
  updateServerHealth(next);

  const validationErrors = validateState(next);
  if (validationErrors.length) {
    setSummary(validationErrors.join(" "), "error");
    return;
  }

  saveJsonToStorage(state.storageKey, next);
  state.server = normalizeState(next);
  state.baseRevision = state.server.state.revision;
  state.draft = null;
  state.original = null;
  state.draftKind = null;
  setDrawerOpen(false);
  render();
  exportSnapshot(next);
  setSummary(`Saved revision ${next.state.revision}. Exported snapshot downloaded.`, "ok");
}

function wireGlobalActions() {
  el.refreshButton.addEventListener("click", async () => {
    await bootstrap(true);
  });
  el.addProjectButton.addEventListener("click", () => openNewProjectDrawer());
  el.closeDrawerButton.addEventListener("click", () => closeDrawer());
  el.saveButton.addEventListener("click", () => saveCurrent());
  el.drawerTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    selectSection(button.dataset.section);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
  window.addEventListener("resize", () => {
    if (state.server) render();
  });
  el.graphViewport.addEventListener("click", (event) => {
    if (event.target === el.graphSvg) {
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      hideTooltip();
      render();
    }
  });
}

function readBootConfig() {
  const url = new URL(window.location.href);
  const queryConfig = url.searchParams.get("config");
  const queryState = url.searchParams.get("state");
  const querySet = url.searchParams.get("set");
  const queryManifest = url.searchParams.get("manifest");
  return { queryConfig, queryState, querySet, queryManifest };
}

async function bootstrap(forceReload = false) {
  const boot = readBootConfig();
  const rootConfigUrl = resolveUrl(window.location.href, boot.queryConfig || "config/plan-graph.config.json");
  const rootConfig = normalizeConfig(await fetchJson(rootConfigUrl));

  let manifest = null;
  let manifestUrl = boot.queryManifest || rootConfig.set_manifest || null;
  let config = rootConfig;
  let configUrl = rootConfigUrl;
  let selectedSet = null;

  if (manifestUrl) {
    try {
      manifestUrl = resolveUrl(rootConfigUrl, manifestUrl);
      manifest = normalizeSetManifest(await fetchJson(manifestUrl));
    } catch {
      manifest = null;
    }
  }

  if (manifest?.sets?.length) {
    const requestedSetKey = boot.querySet || rootConfig.default_set || manifest.default_set || manifest.sets[0].key;
    selectedSet = manifest.sets.find((item) => item.key === requestedSetKey) || manifest.sets[0];
    if (selectedSet?.config_url) {
      configUrl = resolveUrl(manifestUrl, selectedSet.config_url);
      config = normalizeConfig(await fetchJson(configUrl));
    }
  }

  state.manifest = manifest;
  state.manifestUrl = manifestUrl;
  state.availableSets = manifest?.sets || [];
  state.selectedSetKey = selectedSet?.key || boot.querySet || rootConfig.default_set || manifest?.default_set || null;
  state.selectedSetLabel = selectedSet?.label || selectedSet?.key || state.selectedSetKey;
    state.config = config;
    state.configUrl = configUrl;

    const appRootUrl = new URL("/", configUrl).toString();
    const docsManifestSource = config.docs_manifest || "docs/index.json";
    const docsBundle = await loadDocsManifest(appRootUrl, docsManifestSource);
    state.docsManifest = docsBundle.manifest;
    await loadDocsContent(appRootUrl, state.docsManifest);

    const source = boot.queryState && config.allow_state_query_param !== false ? boot.queryState : config.state_source;
    state.sourceUrl = source;
    const sourceUrl = resolveUrl(appRootUrl, source);
    const sourceData = await fetchJson(sourceUrl);
    const normalized = normalizeState(sourceData);
    state.storageKey = inferStorageKey(config, sourceUrl, normalized.state.ecosystem_id, state.selectedSetKey);

    const stored = !forceReload ? loadJsonFromStorage(state.storageKey) : null;
    if (stored && stored.state && stored.schema_version) {
      const normalizedStored = normalizeState(stored);
      const storedErrors = validateState(normalizedStored);
      if (storedErrors.length) {
        state.server = normalized;
        saveJsonToStorage(state.storageKey, state.server);
      } else {
        state.server = normalizedStored;
      }
    } else {
      state.server = normalized;
      saveJsonToStorage(state.storageKey, state.server);
    }

    if (!forceReload && state.server.state.revision < normalized.state.revision) {
      state.server = normalized;
      saveJsonToStorage(state.storageKey, state.server);
    }

  if (!state.draft) {
    state.baseRevision = state.server.state.revision;
  }

  el.validationSummary.textContent = "";
  render();
  if (!state.draft && state.server.projects.length) {
    openProjectDrawer(state.server.projects[0].identity_and_role.project_id);
  }
}

function normalizeConfig(raw) {
  return {
    ...APP_DEFAULTS,
    ...raw,
  };
}

wireGlobalActions();
bootstrap().catch((error) => {
  el.appSubtitle.textContent = error.message;
  setSummary(error.message, "error");
});
