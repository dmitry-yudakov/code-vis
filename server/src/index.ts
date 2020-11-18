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

    const onCommand = async (msg: string, conn: any) => {
      try {
        const res = await project.processCommand(msg);
        sendToWebsocket(res, conn);
      } catch (err) {
        console.log('Error handing message', msg, ':', err);
      }
    };

    startServer(3789, onCommand);
  })
  .catch((err) => {
    console.log('Error starting project:', err);
  });
