# Hermes Component & API Specification

## Purpose

Hermes should render a two-tier System Hub:

1. Meta-Window: global D3 graph, aggregate health, alerts, and cross-project tasks.
2. Project-Window: form-based project editor using the five required project sections.

The canonical data contract is `schemas/ecosystem-hub.schema.json`. The TypeScript shape and factory helper are in `src/types.ts`.

## Component Map

### `SystemHubPage`

Top-level route. Owns loaded `EcosystemHubState`, selected node/project, dirty form state, and save lifecycle.

```ts
interface SystemHubPageProps {
  ecosystemId: string;
}
```

Responsibilities:

- Fetch current state with `GET /api/ecosystems/:ecosystemId`.
- Maintain `selectedProjectId`.
- Pass `meta_window.graph` into D3 renderer.
- Pass selected project into the form editor.
- Apply validated JSON Patch saves.

### `MetaWindow`

Renders global health, alert summary, urgent or blocked meta tasks, and the graph canvas.

```ts
interface MetaWindowProps {
  metaWindow: MetaWindow;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCreateProject: () => void;
}
```

### `D3EcosystemGraph`

Force-directed graph renderer. Nodes are projects, agents, or external systems. Edges are pipelines and must show the `label` badge.

```ts
interface D3EcosystemGraphProps {
  graph: D3Graph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number; pinned: boolean }) => void;
}
```

Rendering rules:

- Node color derives from `status`: active, idle, error.
- Edge badge text is `edge.label`.
- Edge tooltip shows `payload_format`, `channel_type`, `protocol`, and `last_success_at_utc`.
- Clicking a node opens the matching Project-Window when `project_ref` is not null.

### `ProjectWindow`

Tab or stacked section editor for one `ProjectWindow` object.

```ts
interface ProjectWindowProps {
  project: ProjectWindow;
  revision: number;
  onChange: (project: ProjectWindow) => void;
  onSave: (patch: JsonPatchOperation[], baseRevision: number) => Promise<void>;
}
```

Required child sections:

- `IdentityAndRoleSection`
- `InterfacesAndFlowsSection`
- `SchedulerSection`
- `RoadmapAndTasksSection`
- `ExportAndCommitSection`

### `FastProjectForm`

Creates an empty project and graph node using `createEmptyProject(input)`.

```ts
interface FastProjectFormValues {
  project_id: string;
  name: string;
  description?: string;
  role?: string;
  node_type?: "project" | "agent" | "external_system";
}
```

Submit behavior:

- Validate `project_id` uniqueness across project ids and graph node ids.
- Create a project and node together.
- Patch both collections in one transaction.

## API Contract

### `GET /api/ecosystems/:ecosystemId`

Returns `EcosystemHubState`.

### `PATCH /api/ecosystems/:ecosystemId`

Applies RFC 6902 JSON Patch operations.

```ts
interface PatchEcosystemRequest {
  base_revision: number;
  patch: JsonPatchOperation[];
  requested_by: string;
}

interface PatchEcosystemResponse {
  ecosystem: EcosystemHubState;
  applied_revision: number;
  conflicts: Array<{
    path: string;
    reason: string;
  }>;
}
```

Rules:

- Reject when `base_revision` does not equal the stored revision.
- Validate the patched result against the JSON Schema.
- Rebuild `meta_window.meta_tasks` from project tasks where `show_in_meta === true` and `status !== "done"`.
- Recompute `meta_window.health` after each accepted patch.
- Never store API secrets in this document; store references or human-readable auth requirements only.

### `POST /api/ecosystems/:ecosystemId/projects`

Fast-form endpoint for dynamic node addition.

```ts
interface CreateProjectRequest {
  base_revision: number;
  project_id: string;
  name: string;
  description?: string;
  role?: string;
  node_type?: "project" | "agent" | "external_system";
}

interface CreateProjectResponse {
  ecosystem: EcosystemHubState;
  project: ProjectWindow;
  node: GraphNode;
  applied_revision: number;
}
```

Server behavior:

- Call `createEmptyProject`.
- Append to `/projects`.
- Append to `/meta_window/graph/nodes`.
- Increment revision atomically.
- Validate graph consistency before commit.

## State-Management Protocol

Hermes should use optimistic concurrency:

1. Load the ecosystem and store `state.revision`.
2. Edit forms locally.
3. Generate RFC 6902 patch operations from original project state to edited state.
4. Submit patch with `base_revision`.
5. On success, replace local state with the server response.
6. On conflict, show the conflicting paths and refetch.

Graph consistency invariants:

- Every `project.identity_and_role.project_id` must have one matching graph node where `project_ref` equals that id.
- Every edge `source_node` and `target_node` must reference an existing graph node.
- Every project input should be mirrored by an upstream edge when the source participates in the graph.
- Every project output should be mirrored by a downstream edge when the target participates in the graph.
- `meta_window.meta_tasks` is derived state, not hand-authored source of truth.

## Suggested Screen Layout

- Left rail: Meta health, alert count, urgent tasks.
- Center: D3 graph canvas.
- Right inspector: selected Project-Window form.
- Bottom drawer: save preview showing generated JSON Patch operations.

## Save Preview Example

```json
[
  {
    "op": "replace",
    "path": "/projects/2/scheduler/cron_expression",
    "value": "0 */4 * * *"
  },
  {
    "op": "replace",
    "path": "/projects/2/export_and_commit/last_patch",
    "value": [
      {
        "op": "replace",
        "path": "/projects/2/scheduler/cron_expression",
        "value": "0 */4 * * *"
      }
    ]
  }
]
```
