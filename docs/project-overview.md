# Compass Project Overview

## Current status
Compass is the main hub for both financial and non-financial subprojects.

### In scope
- Financial chain: Isracard Mail → Mail Manager → Economic Manager → Compass
- Non-financial chain: Self Manager, Assessment, Administrative
- One shared radial Compass view that shows the relationships between all subprojects

## What to do next
1. Keep the financial ingestion chain visible and healthy.
2. Keep non-financial subprojects visible in the same Compass canvas.
3. Update the per-project roadmap and API records when behavior changes.
4. Use edge labels to describe what data moves between projects.
5. Keep the global overview summary aligned with the live state JSON.

## Where to update things
- **Global overview / whole-project state:** `examples/compass-ecosystem.sample.json` → `meta_window.overview`
- **Project next steps:** each project's `roadmap_and_tasks`
- **APIs and integrations:** each project's `interfaces_and_flows.external_apis`
- **Graph connections:** `meta_window.graph.edges`

## How to make it do work
This app is a visual/state editor. It does not execute work just because you type a sentence into the UI.

To make it act on your request:
1. Write the desired work as concrete tasks in `meta_window.overview.next_steps` and in each project's `roadmap_and_tasks`.
2. Save the state in the UI or commit the JSON file.
3. If you want automatic execution, wire a runner/agent/cron job to read this overview file or the state JSON and perform the tasks.

## Recommended editing flow
- Update the JSON source of truth.
- Refresh the browser to see the updated graph and sidebar.
- Rebuild `dist/` when you want a packaged version.

## Notes
- The UI now has a single Compass canvas, not separate finance/non-finance panels.
- Edge labels should always describe the payload or action between projects.
- If a project has external APIs, list them in the project form so they are visible and editable.
