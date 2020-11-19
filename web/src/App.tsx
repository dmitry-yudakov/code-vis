import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { WSConn } from './connection';
import { History } from './components/History';
import { FileMapping, Include } from './types';
import { IncludesHierarchy } from './components/IncludesHierarchy';

const url = `ws://localhost:3789`;

const LogicMap: React.FC<{ data: FileMapping; onClose: () => void }> = ({
  data,
  onClose,
}) => {
  const [show, setShow] = useState<keyof FileMapping>('content');
  const content = data[show];
  const pre =
    typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return (
    <div>
      <button onClick={() => onClose()}>Back</button>
      <br />
      <button onClick={() => setShow('content')}>Content</button>
      <button onClick={() => setShow('mapping')}>Mapping</button>
      <pre>{pre}</pre>
    </div>
  );
};

const App: React.FC = () => {
  const [projectMap, setProjectMap] = useState<Include[]>([]);
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
            setProjectMap(payload as Include[]);
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
    conn.send('mapFile', nodeName);
  };

  return (
    <div className="App">
      {fileMap ? (
        <LogicMap data={fileMap} onClose={() => setFileMap(null)} />
      ) : (
        <IncludesHierarchy includes={projectMap} onClick={onNodeClick} />
      )}
      <History history={history} />
    </div>
  );
};

export default App;
