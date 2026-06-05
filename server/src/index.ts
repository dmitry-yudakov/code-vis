import ProjectRegistry from './projectRegistry';
import { broadcast, startServer } from './wsserver';

const getArrayLength = (payload: unknown): number =>
  Array.isArray(payload) ? payload.length : 0;

const getPayload = (result: { payload: unknown } | void): unknown =>
  result ? result.payload : undefined;

type CliOptions = {
  projectRootPath?: string;
  forceProjectsDirectory: boolean;
  discoveryDepth: number;
};

const usage =
  'Usage: yarn start [--projects-dir] [--depth N] path/to/project-or-projects';

const parseDiscoveryDepth = (value: string | undefined): number => {
  if (!value) {
    throw new Error('--depth requires a number');
  }

  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error('--depth must be an integer greater than 0');
  }

  return depth;
};

const parseArgs = (rawArgs: string[]): CliOptions => {
  const options: CliOptions = {
    forceProjectsDirectory: false,
    discoveryDepth: 1,
  };

  for (let idx = 0; idx < rawArgs.length; idx++) {
    const arg = rawArgs[idx];

    if (arg === '--projects-dir') {
      options.forceProjectsDirectory = true;
      continue;
    }

    if (arg === '--depth' || arg === '--discovery-depth') {
      options.discoveryDepth = parseDiscoveryDepth(rawArgs[idx + 1]);
      idx++;
      continue;
    }

    if (arg.startsWith('--depth=')) {
      options.discoveryDepth = parseDiscoveryDepth(
        arg.slice('--depth='.length)
      );
      continue;
    }

    if (arg.startsWith('--discovery-depth=')) {
      options.discoveryDepth = parseDiscoveryDepth(
        arg.slice('--discovery-depth='.length)
      );
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.projectRootPath) {
      throw new Error(`Unexpected extra path: ${arg}`);
    }

    options.projectRootPath = arg;
  }

  return options;
};

const args = process.argv.slice(2);
let cliOptions: CliOptions;

try {
  cliOptions = parseArgs(args);
} catch (error: any) {
  console.log(error?.message || 'Invalid arguments');
  console.log(usage);
  process.exit(1);
}

const { projectRootPath, forceProjectsDirectory, discoveryDepth } = cliOptions;

if (!projectRootPath) {
  console.log(usage);
  process.exit(1);
}

console.log('Use project root path', projectRootPath);
console.log('Project discovery depth', discoveryDepth);

const sendResponse = (
  socket: any,
  eventName: string,
  payload: unknown,
  ack?: any
) => {
  if (ack) {
    ack({ success: true, data: payload });
  } else {
    socket.emit(eventName, payload);
  }
};

const sendProjectResult = (
  socket: any,
  eventName: string,
  result: { payload: unknown } | void,
  ack?: any
) => {
  const payload = getPayload(result);

  if (payload) {
    sendResponse(socket, eventName, payload, ack);
    return;
  }

  console.error(`SERVER: ${eventName} returned empty result`, { result });
};

const start = async () => {
  const registry = new ProjectRegistry(projectRootPath, {
    forceProjectsDirectory,
    discoveryDepth,
    onProjectChange: (event) => {
      console.log('Broadcasting projectContentChange', event);
      broadcast('projectContentChange', event);
    },
  });

  await registry.initialize();
  console.log(
    'Discovered projects:',
    registry.getProjectList().projects.length
  );

  if (registry.hasSingleProject()) {
    const projectId = registry.getSingleProjectId();
    if (projectId) {
      await registry.openProject(projectId);
    }
  }

  const handlers = {
    listProjects: async (socket: any, _payload: any, ack?: any) => {
      const projectList = registry.getProjectList();
      sendResponse(socket, 'projectsList', projectList, ack);
    },

    openProject: async (socket: any, payload: any, ack?: any) => {
      const projectId = payload?.projectId;
      if (!projectId) {
        throw new Error('openProject requires projectId');
      }

      const result = await registry.openProject(projectId);
      sendResponse(socket, 'activeProjectChanged', result, ack);
      socket.broadcast.emit('activeProjectChanged', result);
      socket.broadcast.emit('projectMap', result.projectMap);
    },

    mapProject: async (socket: any, payload: any, ack?: any) => {
      console.log('mapProject handler called', { hasAck: !!ack });
      const result = await registry.processActiveProjectCommand(
        'mapProject',
        payload
      );
      console.log('mapProject result', {
        hasResult: !!result,
        hasPayload: !!(result && result.payload),
        payloadType:
          result && result.payload ? typeof result.payload : 'undefined',
        payloadLength: getArrayLength(getPayload(result)),
      });

      sendProjectResult(socket, 'projectMap', result, ack);
    },

    mapFile: async (socket: any, payload: any, ack?: any) => {
      console.log('mapFile handler called', {
        payload,
        hasAck: !!ack,
      });
      const result = await registry.processActiveProjectCommand(
        'mapFile',
        payload
      );
      console.log('mapFile result', {
        hasResult: !!result,
        hasPayload: !!(result && result.payload),
        payloadLength: getArrayLength(getPayload(result)),
      });

      sendProjectResult(socket, 'fileMap', result, ack);
    },

    mapFocusedReview: async (socket: any, payload: any, ack?: any) => {
      console.log('mapFocusedReview handler called', {
        payload,
        hasAck: !!ack,
      });

      const result = await registry.processActiveProjectCommand(
        'mapFocusedReview',
        payload
      );
      sendProjectResult(socket, 'focusedReviewMap', result, ack);
    },

    arrangeReview: async (socket: any, payload: any, ack?: any) => {
      console.log('arrangeReview handler called', {
        entities: getArrayLength(payload?.entities),
        hasAck: !!ack,
      });

      const result = await registry.processActiveProjectCommand(
        'arrangeReview',
        payload
      );
      sendProjectResult(socket, 'reviewArrangement', result, ack);
    },

    listCommits: async (socket: any, payload: any, ack?: any) => {
      console.log('listCommits handler called', {
        payload,
        hasAck: !!ack,
      });

      const result = await registry.processActiveProjectCommand(
        'listCommits',
        payload
      );
      sendProjectResult(socket, 'commitList', result, ack);
    },

    saveFile: async (socket: any, payload: any, ack?: any) => {
      await registry.processActiveProjectCommand('saveFile', payload);

      if (ack) {
        ack({ success: true });
      } else {
        socket.emit('fileSaved', { filename: payload.filename });
      }
    },
  };

  startServer(3789, handlers);
  console.log('Server started, handlers registered:', Object.keys(handlers));
};

start().catch((err) => {
  console.log('Error starting project registry:', err);
  process.exit(1);
});
