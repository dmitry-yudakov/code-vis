import { initProject, processCommand } from './project';
import { sendToWebsocket, startServer } from './wsserver';

const args = process.argv.slice(2);
const projectPath = args[0];
if (!projectPath) {
  console.log('Usage: yarn start path/to/project');
  process.exit(1);
}

console.log('Use project path', projectPath);
initProject(projectPath);

const onCommand = async (msg: string, conn: any) => {
  try {
    const res = await processCommand(msg);
    sendToWebsocket(res, conn);
  } catch (err) {
    console.log('Error handing message', msg, ':', err);
  }
};

startServer(3789, onCommand);
