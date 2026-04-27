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

- [Architecture](docs/architecture.md)
- [Server](docs/server.md)
- [Web](docs/web.md)
- [JS/TS Analyzer](docs/analyzer.md)
- [WebSocket API](docs/websocket-api.md)

## Stories

- [JS Analyzer Improvement](stories/STORY-20251111-js-analyzer-improvement.md)
- [Socket.IO Improvements](stories/STORY-20251111-socket-io-improvements.md)
