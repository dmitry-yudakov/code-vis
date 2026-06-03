# code-vis (code-ai)

Static analysis and visualization tool for JavaScript/TypeScript projects. Parses source files with the TypeScript Compiler API, extracts file dependencies and function calls, and displays them as interactive graphs.

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| Server | `server/` | Node.js. Analyzes project files, serves data over Socket.IO on port 3789 |
| Web | `web/` | React SPA. Connects to server, renders graph views on port 3000 |
| Extension | `extension/` | VS Code extension. Deprecated, not actively maintained |

## Running

```sh
# Server
cd server && yarn start path/to/project

# Web (separate terminal)
cd web && yarn dev
```

## Key Conventions

- Shared types (`FunctionCallInfo`, `FileMapping`, etc.) are duplicated in `server/src/types.d.ts` and `web/src/types.d.ts` — both must be kept in sync.
- `FunctionCallInfo.name` is the stable terminal callable identifier used for matching. Never change its semantics.
- Socket.IO named events only — no generic `command` wrapper.
- File paths in the analyzer are project-relative (not absolute).
- Config stored at `~/.code-ai/projects/{url-encoded-path}/config.json`.

## Docs

- [Vision & North Star](docs/vision.md) — direction-setting (aspirational; where the product is going)
- [Architecture](docs/architecture.md)
- [Server](docs/server.md)
- [Web](docs/web.md)
- [JS/TS Analyzer](docs/analyzer.md)
- [WebSocket API](docs/websocket-api.md)

## Stories (spec-driven loop)

Implementation stories (specs/handoffs) live in `stories/`, named `STORY-<YYYYMMDD>-<title>.md`.

Non-trivial changes are spec-driven:

1. **Spec first.** Write or extend a story using [`stories/TEMPLATE.md`](stories/TEMPLATE.md) before implementing (`Status: Draft`). A story must carry **acceptance criteria as `- [ ]` checkboxes** and a **"where the code is"** section anchoring to `file:line` — these are what make a spec executable rather than just prose.
2. **Implement against it.** Set `Status: In progress` and tick boxes `[x]` as each criterion is satisfied.
3. **Done = every box `[x]` and "How to verify" passes.** Flip to `Status: Shipped` and update the story to match what actually shipped. (Set `Superseded` instead if a later story replaces it.)

Stories sit under [docs/vision.md](docs/vision.md) (the north star); reference the relevant phase/MVP when scoping one.

