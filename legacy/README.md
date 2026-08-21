# Legacy runtime — static code visualizer

This directory is an **archive**. It holds the original product: a Node.js static-analysis server,
a React single-page client, and a VS Code extension that visualized connections between files and
functions in JavaScript/TypeScript projects.

It has been superseded by the CodeAI application at the repository root (see the root
[README](../README.md) and [docs/architecture.md](../docs/architecture.md)).

**Status: not maintained.** Nothing here is built, started, linted, tested, or imported by the
root application. The root TypeScript project, Vitest include set, and Playwright test directory
all exclude `legacy/`. It is kept as a coherent historical snapshot and as a reference for the
model/lens ideas in [docs/vision.md](../docs/vision.md) — its dependencies, protocols, duplicated
types, and UI are deliberately left exactly as they were.

## What is here

| Path | What it was |
|------|-------------|
| [server/](server/) | Node.js. Parsed source with the TypeScript Compiler API, extracted file dependencies and function calls, served them over Socket.IO on port 3789 |
| [web/](web/) | React SPA. Connected to the server and rendered graph views on port 3000 |
| [extension/](extension/) | VS Code extension. Already deprecated before the archive; it loaded files and talked to `web/` the way `server/` did |
| [docs/](docs/) | Reference documentation for exactly this runtime |

## Documentation

- [Architecture](docs/architecture.md) — how the three pieces fitted together
- [Server](docs/server.md)
- [Web](docs/web.md)
- [JS/TS analyzer](docs/analyzer.md)
- [WebSocket API](docs/websocket-api.md)

These describe the archived runtime only. The current product's architecture is
[docs/architecture.md](../docs/architecture.md) at the repository root.

## Running it for historical comparison

The packages keep their own dependencies and are not part of the root Yarn package. They were last
exercised before the archive; treat any failure as a pre-existing condition rather than something
to repair here.

Server:

```sh
cd legacy/server
yarn
yarn start path/to/project-or-projects
```

Web, in another terminal:

```sh
cd legacy/web
yarn
yarn dev
```

That opens <http://localhost:3000>. If the server path points at a single project, the web app
opens it automatically. If the path points at a directory of projects, the web app starts with a
project list sorted by recent activity and last modified time.

The server auto-detects a single project when the path contains markers such as `package.json`,
`tsconfig.json`, or `.git`. To force directory-of-projects mode:

```sh
yarn start --projects-dir path/to/projects
```

Project discovery is shallow by default (`--depth 1`). To include nested projects, pass a larger
depth:

```sh
yarn start --projects-dir --depth 2 path/to/projects
```

## Conventions that applied here only

Do not carry these into `src/`:

- Shared types (`FunctionCallInfo`, `FileMapping`, …) are **duplicated** in
  [server/src/types.d.ts](server/src/types.d.ts) and [web/src/types.d.ts](web/src/types.d.ts) and
  had to be kept in sync by hand.
- `FunctionCallInfo.name` is the stable terminal callable identifier used for matching.
- Socket.IO named events only — no generic `command` wrapper.
- File paths in the analyzer are project-relative, not absolute.
- Project configuration lives at `~/.code-ai/projects/{url-encoded-path}/config.json`.
