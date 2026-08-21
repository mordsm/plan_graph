# Plan Graph

A schema-driven D3 ecosystem hub for the `plan_graph` repo.

## What it includes

- `index.html`: single-page app entrypoint.
- `app.js`: D3 graph, project drawer, edge inspector, patch generation, and local save/export flow.
- `styles.css`: UI shell, graph canvas, drawer, and responsive styling.
- `config/plan-graph.config.json`: default app config and source state path.
- `vendor/d3.min.js`: local D3 runtime for offline-safe rendering.
- `schemas/ecosystem-hub.schema.json`: JSON Schema Draft 7 contract.
- `src/types.ts`: TypeScript interfaces, empty-project factory, and meta-task derivation helper.
- `examples/compas-ecosystem.sample.json`: sample ecosystem state.
- `docs/hermes-component-api-spec.md`: component, API, and state-management spec for Hermes.

## Core model

The hub has two layers:

- Meta-Window: global D3 graph, aggregate health, alerts, and urgent cross-project tasks.
- Project-Window: strict five-section form contract for each project.

Edges are first-class data-pipeline records and include badge labels such as `Statement.CSV` or `REST JSON`.

## Run locally

Serve the repo root and open `index.html`:

```bash
python -m http.server 8000
```

Then visit `http://127.0.0.1:8000/`.

## Config-driven reuse

To use the same app on another project set, change `config/plan-graph.config.json` or pass `?config=...`, `?manifest=...`, `?set=...`, and `?state=...` in the URL.

The built-in selector uses `config/sets/index.json`.

## Packaged build

Create a deployable `dist/` bundle and zip archive:

```bash
python scripts/build.py
```

Then serve `dist/` with:

```bash
python -m http.server 8080 -d dist
```
