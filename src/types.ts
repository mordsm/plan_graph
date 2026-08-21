export type OperationalStatus = "active" | "idle" | "error";
export type GlobalHealthStatus = "healthy" | "degraded" | "critical" | "unknown";
export type PayloadFormat = "CSV" | "JSON" | "HTML" | "PDF" | "TXT" | "REST_JSON" | "EMAIL" | "MIXED";
export type Protocol = "imap" | "smtp" | "rest" | "filesystem" | "database" | "queue" | "webhook" | "manual" | "internal";
export type ChannelType = "direct_push" | "queue" | "webhook" | "polling" | "manual_upload" | "scheduled_pull";
export type TaskStatus = "planned" | "in_progress" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface EcosystemHubState {
  schema_version: string;
  state: StateEnvelope;
  meta_window: MetaWindow;
  projects: ProjectWindow[];
}

export interface StateEnvelope {
  ecosystem_id: string;
  revision: number;
  updated_at_utc: string;
  updated_by: string;
  lock: {
    mode: "unlocked" | "optimistic" | "locked";
    owner?: string | null;
    expires_at_utc?: string | null;
  };
}

export interface MetaWindow {
  graph: D3Graph;
  health: {
    status: GlobalHealthStatus;
    checked_at_utc: string;
    active_projects: number;
    blocked_tasks: number;
    open_alerts: number;
  };
  alerts: Alert[];
  meta_tasks: MetaTask[];
}

export interface D3Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: {
    engine: "d3-force" | "dagre" | "manual";
    version: string;
    viewport?: {
      x: number;
      y: number;
      zoom: number;
    };
  };
}

export interface GraphNode {
  node_id: string;
  node_type: "project" | "agent" | "external_system";
  label: string;
  project_ref: string | null;
  status: OperationalStatus;
  position?: {
    x: number;
    y: number;
    pinned: boolean;
  };
  tags?: string[];
}

export interface GraphEdge {
  edge_id: string;
  label: string;
  source_node: string;
  target_node: string;
  channel_type: ChannelType;
  payload_format: PayloadFormat;
  protocol?: Protocol;
  status: "healthy" | "degraded" | "blocked" | "unknown";
  last_success_at_utc?: string | null;
}

export interface ProjectWindow {
  identity_and_role: {
    project_id: string;
    name: string;
    description: string;
    role: string;
    operational_status: OperationalStatus;
  };
  interfaces_and_flows: {
    inputs: FlowInput[];
    outputs: FlowOutput[];
    external_apis: ExternalApi[];
  };
  scheduler: Scheduler;
  roadmap_and_tasks: ProjectTask[];
  export_and_commit: ExportAndCommit;
}

export interface FlowInput {
  source_node: string;
  payload_format: PayloadFormat;
  protocol: Protocol;
  channel?: string;
  required?: boolean;
}

export interface FlowOutput {
  target_node: string;
  payload_format: PayloadFormat;
  protocol: Protocol;
  channel?: string;
  required?: boolean;
}

export interface ExternalApi {
  endpoint_name: string;
  base_url?: string | null;
  trigger_mode: "scheduled" | "event" | "manual";
  auth_requirements: string;
  rate_limit?: string | null;
}

export interface Scheduler {
  cron_expression: string | null;
  next_run_utc: string | null;
  execution_type: "automated_api" | "local_worker" | "manual_run" | "not_scheduled";
  requires_manual_login: boolean;
  timezone?: string;
}

export interface ProjectTask {
  task_id: string;
  title: string;
  type: "api_job" | "roadmap_task";
  status: TaskStatus;
  priority: TaskPriority;
  show_in_meta: boolean;
  blocked_reason?: string | null;
  due_at_utc?: string | null;
}

export interface ExportAndCommit {
  patch_protocol: "json_patch_rfc6902";
  last_patch: JsonPatchOperation[] | null;
  commit_message_template?: string;
}

export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
}

export interface Alert {
  alert_id: string;
  severity: "info" | "warning" | "critical";
  source_node: string;
  message: string;
  created_at_utc: string;
  status: "open" | "acknowledged" | "resolved";
}

export interface MetaTask {
  project_id: string;
  task_id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
}

export interface ProjectFactoryInput {
  project_id: string;
  name: string;
  description?: string;
  role?: string;
  node_type?: GraphNode["node_type"];
  status?: OperationalStatus;
}

export function createEmptyProject(input: ProjectFactoryInput): {
  project: ProjectWindow;
  node: GraphNode;
} {
  const status = input.status ?? "idle";

  return {
    node: {
      node_id: input.project_id,
      node_type: input.node_type ?? "project",
      label: input.name,
      project_ref: input.project_id,
      status,
      tags: []
    },
    project: {
      identity_and_role: {
        project_id: input.project_id,
        name: input.name,
        description: input.description ?? "",
        role: input.role ?? "",
        operational_status: status
      },
      interfaces_and_flows: {
        inputs: [],
        outputs: [],
        external_apis: []
      },
      scheduler: {
        cron_expression: null,
        next_run_utc: null,
        execution_type: "not_scheduled",
        requires_manual_login: false,
        timezone: "UTC"
      },
      roadmap_and_tasks: [],
      export_and_commit: {
        patch_protocol: "json_patch_rfc6902",
        last_patch: null,
        commit_message_template: "Update {project_id}: {summary}"
      }
    }
  };
}

export function deriveMetaTasks(projects: ProjectWindow[]): MetaTask[] {
  return projects.flatMap((project) =>
    project.roadmap_and_tasks
      .filter((task) => task.show_in_meta && task.status !== "done")
      .map((task) => ({
        project_id: project.identity_and_role.project_id,
        task_id: task.task_id,
        title: task.title,
        priority: task.priority,
        status: task.status
      }))
  );
}
