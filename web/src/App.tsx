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
import { initConnection, sendToServer } from './connection';
import { History } from './components/History';
import { FileIncludeInfo, FileMapDetailed } from './types';
import { IncludesHierarchy } from './components/IncludesHierarchy';
import { LogicMap } from './components/LogicMap';
import Menu from './atoms/Menu';
import { FilesMapping } from './components/FilesMapping';

const url = `ws://localhost:3789`;

const ProjectDataContext = React.createContext<{
  projectMap: FileIncludeInfo[];
  filesMappings: Record<string, FileMapDetailed>;
  forceReloadToken: number;
}>({ projectMap: [], filesMappings: {}, forceReloadToken: 0 });

const FileScreen: React.FC<{ fineGrained?: boolean }> = ({
  fineGrained = false,
}) => {
  const { filename: filenameEnc } = useParams<{ filename: string }>();
  const filename = decodeURIComponent(filenameEnc);
  const router = useHistory();

  const { projectMap, filesMappings, forceReloadToken } = useContext(
    ProjectDataContext
  );

  useEffect(() => sendToServer('mapFile', { filename, includeRelated: true }), [
    filename,
    forceReloadToken,
  ]);

  const fileData = filesMappings[filename];
  if (!fileData) return <div>Loading...</div>;

  // TODO show related files too
  // TODO show files referencing this one too

  return fineGrained ? (
    <LogicMap
      filename={filename}
      projectMap={projectMap}
      onClose={() => router.push('/')}
      onRequestRelatedFile={(fn) => filesMappings[fn] || null}
      onSave={async (filename, content, pos, end) =>
        sendToServer('saveFile', { filename, content, pos, end })
      }
    />
  ) : (
    <FilesMapping
      data={fileData}
      filename={filename}
      projectMap={projectMap}
      onClose={() => router.push('/')}
      onRequestRelatedFile={(fn) => filesMappings[fn] || null}
      onSave={async (filename, content) =>
        sendToServer('saveFile', { filename, content })
      }
    />
  );
};

const App: React.FC = () => {
  const router = useHistory();

  const [projectMap, setProjectMap] = useState<FileIncludeInfo[]>([]);
  const [filesMappings, setFilesMappings] = useState<
    Record<string, FileMapDetailed>
  >({});

  const [forceReloadDep, setForceReloadDep] = useState(0);

  const contextVal = useMemo(
    () => ({ projectMap, filesMappings, forceReloadToken: forceReloadDep }),
    [projectMap, filesMappings, forceReloadDep]
  );

  const [history, setHistory] = useState<any[][]>([]);
  const appendToHistory = (str: string) =>
    setHistory((hist) => [...hist, [new Date(), str]]);

  const refWatcherHandler = useRef<any>();
  refWatcherHandler.current = (type: string, path: string) => {
    // switch (type) {
    //   case 'add':
    //   case 'remove':
    sendToServer('mapProject');
    // break;
    // case 'change':
    // if(!!filesMappings[path]) {}
    // }
    setForceReloadDep((i) => i + 1);
  };

  useEffect(() => {
    const onMessage = (type: string, payload: object) => {
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
        case 'projectContentChange':
          const { type, path } = payload as any;
          refWatcherHandler.current(type, path);
          break;
        default:
        // appendToHistory('Unrecognized: ' + JSON.stringify(msg));
      }
    };
    const onOpen = () => {
      console.log('opened');
      sendToServer('mapProject');
    };

    initConnection({ url, onOpen, onMessage });
  }, []);

  return (
    <div className="App">
      <ProjectDataContext.Provider value={contextVal}>
        <Switch>
          <Route path="/f/:filename">
            <FileScreen />
          </Route>
          <Route path="/l/:filename">
            <FileScreen fineGrained />
          </Route>
          <Route path="/">
            <IncludesHierarchy
              includes={projectMap}
              renderNodeMenu={(filename, anchor, onClose) => (
                <Menu
                  positionAnchor={anchor}
                  options={[
                    [
                      'Logic Map',
                      () => router.push(`/l/${encodeURIComponent(filename)}`),
                    ],
                    [
                      'File Map',
                      () => router.push(`/f/${encodeURIComponent(filename)}`),
                    ],
                  ]}
                  onClose={onClose}
                />
              )}
            />
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
