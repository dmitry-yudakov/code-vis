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

yarn start path/to/project
```

In another console:

```
cd web/
yarn start
```

It opens http://localhost:3000 showing content for the project, opened in the server.

To open another one, stop the server and run it again with new path passed to it - the web will reconnect automatically.
