import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useCallback,
} from 'react';
import './App.css';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  useParams,
  useHistory,
} from 'react-router-dom';
import lodash from 'lodash';
import { initConnection, projectApi } from './connection';
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

  const { projectMap, filesMappings, forceReloadToken } =
    useContext(ProjectDataContext);

  const [localFileData, setLocalFileData] = useState<FileMapDetailed | null>(
    null
  );
  const [relatedFiles, setRelatedFiles] = useState<
    Record<string, FileMapDetailed>
  >({});

  useEffect(() => {
    // Check if we already have the data in context
    const cachedData = filesMappings[filename];
    if (cachedData) {
      console.log('🟢 FileScreen: Using cached data for', filename);
      setLocalFileData(cachedData);
      return;
    }

    // Otherwise, fetch it
    console.log('🟢 FileScreen: Fetching file map for', filename);
    projectApi
      .getFileMap(filename, true)
      .then((data) => {
        console.log('🟢 FileScreen: Received file map data', {
          dataType: typeof data,
          isArray: Array.isArray(data),
          length: data ? data.length : 0,
          files: data ? data.map((f: any) => f.filename) : [],
        });
        // The data is an array of file mappings
        if (Array.isArray(data) && data.length > 0) {
          // First item should be the main file
          const mainFile =
            data.find((f: any) => f.filename === filename) || data[0];
          setLocalFileData(mainFile);

          // Store all files (including related) for onRequestRelatedFile
          const allFilesMap: Record<string, FileMapDetailed> = {};
          data.forEach((fileMap: any) => {
            if (fileMap && fileMap.filename) {
              allFilesMap[fileMap.filename] = fileMap;
            }
          });
          console.log(
            '🟢 FileScreen: Stored related files',
            Object.keys(allFilesMap)
          );
          setRelatedFiles(allFilesMap);
        }
      })
      .catch((err) => {
        console.error('Error loading file map:', err);
      });
  }, [filename, forceReloadToken, filesMappings]);

  // Create a merged map for onRequestRelatedFile that includes both context and local data
  // Use useCallback to ensure the function updates when relatedFiles changes
  const getRelatedFile = useCallback(
    (fn: string) => {
      const result = relatedFiles[fn] || filesMappings[fn] || null;
      console.log('🟢 getRelatedFile called', {
        requestedFile: fn,
        foundInRelated: !!relatedFiles[fn],
        foundInContext: !!filesMappings[fn],
        hasResult: !!result,
        relatedFilesKeys: Object.keys(relatedFiles),
      });
      return result;
    },
    [relatedFiles, filesMappings]
  );

  const fileData = localFileData || filesMappings[filename];
  if (!fileData) return <div>Loading...</div>;

  return fineGrained ? (
    <LogicMap
      key={`${filename}-${Object.keys(relatedFiles).length}`}
      filename={filename}
      projectMap={projectMap}
      onClose={() => router.push('/')}
      onRequestRelatedFile={getRelatedFile}
      onSave={async (filename, content, pos, end) => {
        try {
          await projectApi.saveFile(filename, content, pos, end);
          console.log('File saved successfully');
        } catch (error) {
          console.error('Error saving file:', error);
        }
      }}
    />
  ) : (
    <FilesMapping
      key={`${filename}-${Object.keys(relatedFiles).length}`}
      data={fileData}
      filename={filename}
      projectMap={projectMap}
      onClose={() => router.push('/')}
      onRequestRelatedFile={getRelatedFile}
      onSave={async (filename, content) => {
        try {
          await projectApi.saveFile(filename, content);
          console.log('File saved successfully');
        } catch (error) {
          console.error('Error saving file:', error);
        }
      }}
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
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  const contextVal = useMemo(
    () => ({ projectMap, filesMappings, forceReloadToken: forceReloadDep }),
    [projectMap, filesMappings, forceReloadDep]
  );

  const [history, setHistory] = useState<any[][]>([]);
  const appendToHistory = (str: string) =>
    setHistory((hist) => [...hist, [new Date(), str]]);

  useEffect(() => {
    // Initialize Socket.IO connection
    const conn = initConnection(url);

    // Handle connection events
    conn.on('connect', async () => {
      console.log('🟢 APP: Connected to server');
      setConnectionStatus('connected');
      appendToHistory('Connected to server');

      // Load initial project map
      try {
        console.log('🟢 APP: Requesting initial project map...');
        const map = await projectApi.getProjectMap();
        console.log('🟢 APP: Received project map', {
          mapType: typeof map,
          isArray: Array.isArray(map),
          length: map ? map.length : 'null/undefined',
          firstItem: map && map[0] ? Object.keys(map[0]) : 'none',
        });
        setProjectMap(map);
        console.log('🟢 APP: setProjectMap called with', {
          length: map ? map.length : 0,
        });
        appendToHistory('Project map loaded');
      } catch (error) {
        console.error('❌ APP: Error loading project map:', error);
        appendToHistory('Error loading project map: ' + error);
      }
    });

    conn.on('disconnect', ({ reason }) => {
      console.log('Disconnected from server:', reason);
      setConnectionStatus('disconnected');
      appendToHistory('Disconnected: ' + reason);
    });

    conn.on('error', ({ error }) => {
      console.error('Connection error:', error);
      appendToHistory('Connection error: ' + error);
    });

    // Subscribe to project changes
    const unsubscribeProjectChange = projectApi.onProjectChange(
      async (event) => {
        const { type, path } = event;
        appendToHistory(`File ${type}: ${path}`);

        // Reload project map on any file change
        try {
          const map = await projectApi.getProjectMap();
          setProjectMap(map);
          setForceReloadDep((i) => i + 1);
        } catch (error) {
          console.error('Error reloading project:', error);
        }
      }
    );

    // Subscribe to project map updates
    const unsubscribeProjectMap = projectApi.onProjectMap((data) => {
      console.log('🟢 APP: onProjectMap handler called', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      appendToHistory('Project map updated');
      setProjectMap(data);
      console.log('🟢 APP: setProjectMap called from onProjectMap');
    });

    // Subscribe to file map updates
    const unsubscribeFileMap = projectApi.onFileMap((data) => {
      console.log('🟢 APP: onFileMap handler called', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      appendToHistory('File map received');
      console.log('fileMap', data);
      const mappingsObj = lodash.keyBy(data, 'filename');
      setFilesMappings((filesMappings) => ({
        ...filesMappings,
        ...mappingsObj,
      }));
    });

    // Cleanup on unmount
    return () => {
      unsubscribeProjectChange();
      unsubscribeProjectMap();
      unsubscribeFileMap();
      conn.disconnect();
    };
  }, []);

  return (
    <div className="App">
      {/* Connection status indicator */}
      <div className={`connection-status ${connectionStatus}`}>
        {connectionStatus === 'connecting' && '🔄 Connecting...'}
        {connectionStatus === 'connected' && '✅ Connected'}
        {connectionStatus === 'disconnected' && '❌ Disconnected'}
      </div>

      <ProjectDataContext.Provider value={contextVal}>
        <Switch>
          <Route path="/f/:filename">
            <FileScreen />
          </Route>
          <Route path="/fine/:filename">
            <FileScreen fineGrained />
          </Route>
          <Route path="/">
            <IncludesHierarchy
              includes={projectMap}
              renderNodeMenu={(
                filename: string,
                anchor: Element,
                onClose: () => void
              ) => (
                <Menu
                  positionAnchor={anchor}
                  options={[
                    [
                      'Logic Map',
                      () =>
                        router.push(`/fine/${encodeURIComponent(filename)}`),
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
        <History history={history} />
      </ProjectDataContext.Provider>
    </div>
  );
};

function AppRoot() {
  return (
    <Router>
      <App />
    </Router>
  );
}

export default AppRoot;
