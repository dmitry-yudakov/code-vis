import { defaultConfig, loadConfiguration } from './io';
import Project from './project';
import { broadcast, startServer } from './wsserver';

const args = process.argv.slice(2);
const projectPath = args[0];
if (!projectPath) {
  console.log('Usage: yarn start path/to/project');
  process.exit(1);
}

console.log('Use project path', projectPath);

loadConfiguration(projectPath)
  .then((conf) => {
    console.log('Project conf:', conf);
    const project = new Project(projectPath, conf || defaultConfig);

    // Define handlers for each command type
    const handlers = {
      // Map project - returns full project hierarchy
      mapProject: async (socket: any, payload: any, ack?: any) => {
        console.log('mapProject handler called', { hasAck: !!ack });
        const result = await project.processCommand('mapProject', payload);
        console.log('mapProject result', {
          hasResult: !!result,
          hasPayload: !!(result && result.payload),
          payloadType:
            result && result.payload ? typeof result.payload : 'undefined',
          payloadLength: result && result.payload ? result.payload.length : 0,
        });

        if (result && result.payload) {
          if (ack) {
            // Send via acknowledgment if callback provided
            console.log('Sending mapProject via acknowledgment', {
              dataLength: result.payload.length,
            });
            ack({ success: true, data: result.payload });
          } else {
            // Send as event if no callback
            console.log('Sending mapProject via event', {
              dataLength: result.payload.length,
            });
            socket.emit('projectMap', result.payload);
          }
        } else {
          console.error('❌ SERVER: mapProject returned empty result!', {
            result,
          });
        }
      },

      // Map file - returns detailed file analysis
      mapFile: async (socket: any, payload: any, ack?: any) => {
        console.log('mapFile handler called', {
          payload,
          hasAck: !!ack,
        });
        const result = await project.processCommand('mapFile', payload);
        console.log('mapFile result', {
          hasResult: !!result,
          hasPayload: !!(result && result.payload),
          payloadLength: result && result.payload ? result.payload.length : 0,
        });

        if (result && result.payload) {
          if (ack) {
            console.log('Sending mapFile via acknowledgment');
            ack({ success: true, data: result.payload });
          } else {
            console.log('Sending mapFile via event');
            socket.emit('fileMap', result.payload);
          }
        }
      },

      // Save file - writes content to disk
      saveFile: async (socket: any, payload: any, ack?: any) => {
        await project.processCommand('saveFile', payload);

        if (ack) {
          ack({ success: true });
        } else {
          socket.emit('fileSaved', { filename: payload.filename });
        }
      },
    };

    startServer(3789, handlers);
    console.log('Server started, handlers registered:', Object.keys(handlers));

    // Watch for file changes and broadcast to all clients
    project.watch((e) => {
      console.log('Broadcasting projectContentChange', e);
      broadcast('projectContentChange', e);
    });

    return project.recreateProjectMap();
  })
  .catch((err) => {
    console.log('Error starting project:', err);
    process.exit(1);
  });
