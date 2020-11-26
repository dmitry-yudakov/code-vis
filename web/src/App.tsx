import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { WSConn } from './connection';
import { History } from './components/History';
import { FileIncludeInfo } from './types';
import { IncludesHierarchy } from './components/IncludesHierarchy';
import { LogicMap } from './components/LogicMap';

const url = `ws://localhost:3789`;

const App: React.FC = () => {
  const [projectMap, setProjectMap] = useState<FileIncludeInfo[]>([]);
  const [filename, setFilename] = useState<any>(null);
  const [fileMap, setFileMap] = useState<any>(null);
  const [history, setHistory] = useState<any[][]>([]);
  const appendToHistory = (str: string) =>
    setHistory((hist) => [...hist, [new Date(), str]]);

  const refConn = useRef<WSConn | null>(null);
  useEffect(() => {
    const conn = new WSConn(
      url,
      (type, payload) => {
        console.log(type, payload);
        switch (type) {
          case 'keywords':
            // reinitGrammar(msg.payload);
            appendToHistory('Keywords received');
            break;
          case 'projectMap':
            // appendToHistory(msg.payload);
            appendToHistory('Project map received');
            setProjectMap(payload as FileIncludeInfo[]);
            // projectMapData = msg.payload;
            // renderGraph(payload);
            break;
          case 'fileMap':
            appendToHistory('File map received');
            console.log('fileMap', payload);
            setFileMap(payload);
            // projectMapData = msg.payload;
            // renderGraph(payload);
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

  const onNodeClick = (nodeName: string) => {
    console.log('Click on', nodeName);
    const conn = refConn.current;
    if (!conn) {
      return alert('Not connected to server!');
    }
    setFilename(nodeName);
    conn.send('mapFile', nodeName);
  };

  return (
    <div className="App">
      {fileMap && filename ? (
        <LogicMap
          data={fileMap}
          filename={filename}
          projectMap={projectMap}
          onClose={() => {
            setFileMap(null);
            setFilename(null);
          }}
        />
      ) : (
        <IncludesHierarchy includes={projectMap} onClick={onNodeClick} />
      )}
      <History history={history} />
    </div>
  );
};

export default App;
