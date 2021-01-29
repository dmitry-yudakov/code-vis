import { defaultConfig, loadConfiguration, saveConfiguration } from './io';
import Project from './project';
import { sendToWebsocket, startServer } from './wsserver';

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

    const onCommand = async (
      conn: any,
      type: string,
      payload: string | undefined
    ) => {
      try {
        const res = await project.processCommand(type, payload);
        sendToWebsocket(res, conn);
      } catch (err) {
        console.log('Error handing message', type, ':', err);
      }
    };

    startServer(3789, onCommand);

    project.watch((e) =>
      sendToWebsocket({ type: 'projectContentChange', payload: e })
    );

    return project;
  })
  .then((project) => {
    return project.recreateProjectMap();
  })
  .catch((err) => {
    console.log('Error starting project:', err);
  });
