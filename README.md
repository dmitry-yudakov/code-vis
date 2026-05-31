# Code AI

This tool is intended to help working on software projects (javascript and typescript for the moment), visualizing connections between different parts of logic - files, functions.

Two main parts for the moment are nodejs-based **server** and React-based **web** communicating over websocket.

VSCode **extension** part is not really supported at the moment - it worked in the same manner as **server**, loading files and communicating with **web**. In future it might make sense again.

# Installation

Server
```
cd server/

yarn
```

Web
```
cd web/

yarn
```


# Usage

```
cd server/

yarn start path/to/project-or-projects
```

In another console:

```
cd web/
yarn dev
```

It opens http://localhost:3000. If the server path points at a single project,
the web app opens it automatically. If the path points at a directory of
projects, the web app starts with a project list sorted by recent activity and
last modified time.

The server auto-detects a single project when the path contains markers such as
`package.json`, `tsconfig.json`, or `.git`. To force directory-of-projects mode:

```
yarn start --projects-dir path/to/projects
```

Project discovery is shallow by default (`--depth 1`). To include nested
projects, pass a larger depth:

```
yarn start --projects-dir --depth 2 path/to/projects
```
