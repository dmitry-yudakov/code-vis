import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import './App.css';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  useParams,
  useHistory,
} from 'react-router-dom';
import lodash from 'lodash';
import { WSConn } from './connection';
import { History } from './components/History';
import { FileIncludeInfo, FileMapDetailed } from './types';
import { IncludesHierarchy } from './components/IncludesHierarchy';
import { LogicMap } from './components/LogicMap';

const url = `ws://localhost:3789`;
let conn: WSConn;
const sendToServer = (command: string, payload: object) => {
  if (!conn) {
    console.log(
      'Cannot send',
      command,
      '- no connection to server. Try again in a sec'
    );
    setTimeout(() => sendToServer(command, payload), 500);
    return;
  }
  conn.send(command, payload);
};

const ProjectDataContext = React.createContext<{
  projectMap: FileIncludeInfo[];
  filesMappings: Record<string, FileMapDetailed>;
}>({ projectMap: [], filesMappings: {} });

const FileScreen: React.FC = () => {
  const { filename: filenameEnc } = useParams<{ filename: string }>();
  const filename = decodeURIComponent(filenameEnc);
  const router = useHistory();

  useEffect(() => sendToServer('mapFile', { filename, includeRelated: true }), [
    filename,
  ]);

  const { projectMap, filesMappings } = useContext(ProjectDataContext);

  const fileData = filesMappings[filename];
  if (!fileData) return <div>Loading...</div>;

  // TODO show related files too
  // TODO show files referencing this one too

  return (
    <LogicMap
      filename={filename}
      projectMap={projectMap}
      onClose={() => router.push('/')}
      onRequestRelatedFile={(fn) => filesMappings[fn] || null}
    />
  );
};

const App: React.FC = () => {
  const router = useHistory();

  const [projectMap, setProjectMap] = useState<FileIncludeInfo[]>([]);
  const [filesMappings, setFilesMappings] = useState<
    Record<string, FileMapDetailed>
  >({});
  const contextVal = useMemo(() => ({ projectMap, filesMappings }), [
    projectMap,
    filesMappings,
  ]);

  const [history, setHistory] = useState<any[][]>([]);
  const appendToHistory = (str: string) =>
    setHistory((hist) => [...hist, [new Date(), str]]);

  const refConn = useRef<WSConn | null>(null);
  useEffect(() => {
    conn = new WSConn(
      url,
      (type, payload) => {
        console.log(type, payload);
        switch (type) {
          case 'keywords':
            appendToHistory('Keywords received');
            break;
          case 'projectMap':
            appendToHistory('Project map received');
            setProjectMap(payload as FileIncludeInfo[]);
            break;
          case 'fileMap':
            appendToHistory('File map received');
            console.log('fileMap', payload);
            const mappingsObj = lodash.keyBy(payload, 'filename');
            setFilesMappings((filesMappings) => ({
              ...filesMappings,
              ...mappingsObj,
            }));
            break;
          case 'info':
            appendToHistory(JSON.stringify(payload));
            break;
          default:
          // appendToHistory('Unrecognized: ' + JSON.stringify(msg));
        }
      },
      () => {
        console.log('opened');
        conn.send('mapProject');
      }
    );
    refConn.current = conn;
  }, []);

  const onNodeClick = (fileName: string) => {
    console.log('Click on', fileName);
    const conn = refConn.current;
    if (!conn) {
      return alert('Not connected to server!');
    }
    router.push(`/f/${encodeURIComponent(fileName)}`);
  };

  return (
    <div className="App">
      <ProjectDataContext.Provider value={contextVal}>
        <Switch>
          <Route path="/f/:filename">
            <FileScreen />
          </Route>
          <Route path="/">
            <IncludesHierarchy includes={projectMap} onClick={onNodeClick} />
          </Route>
        </Switch>
      </ProjectDataContext.Provider>
      <History history={history} />
    </div>
  );
};

const defaultApp = () => (
  <Router>
    <App />
  </Router>
);
export default defaultApp;
