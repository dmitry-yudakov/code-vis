import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { WSConn } from './connection';
import ReactFlow, { Background } from 'react-flow-renderer';

const url = `ws://localhost:3789`;

interface Include {
  items: string[];
  to: string;
  from: string;
}

const rand = (upperLimit: number) => Math.floor(Math.random() * upperLimit);

// const elements = [
//   { id: "1", data: { label: "Node 1" }, position: { x: 250, y: 5 } },
//   // you can also pass a React component as a label
//   {
//     id: "2",
//     data: { label: <div style={{ height: 250, width: 250 }}>gaga 42</div> },
//     position: { x: 100, y: 100 },
//   },
//   { id: "e1-2", source: "1", target: "2", animated: false },
// ];

const extractNodes = (includes: Include[]): string[] => {
  return Array.from(new Set(includes.flatMap((incl) => [incl.from, incl.to])));
};
const getNodesObj = (nodes: string[]) =>
  nodes.reduce((obj, node, idx) => {
    obj[node] = idx.toString();
    return obj;
  }, {} as Record<string, string>);

const Mapper: React.FC<{
  includes: Include[];
  onClick: (nodeName: string) => void;
}> = React.memo(({ includes, onClick }) => {
  console.log('includes', includes);
  const nodes = extractNodes(includes);
  const nodesObj = getNodesObj(nodes);

  const elements = [
    // nodes
    ...nodes.map((name) => ({
      id: nodesObj[name],
      data: { label: name },
      position: { x: rand(window.innerWidth), y: rand(window.innerHeight) },
    })),
    // edges
    ...includes.map(({ from, to, items }, idx) => {
      const source = nodesObj[from];
      const target = nodesObj[to];
      return {
        id: `${source}-${target}-${idx}`,
        type: 'straight',
        source,
        target,
        label: items.join(items[0] === '*' ? ' ' : ', '),
      };
    }),
  ];

  console.log('generated elements', elements);
  return (
    <div className="mapper">
      <ReactFlow
        elements={elements}
        onElementClick={(e, el) => {
          if (el.data) {
            onClick(el.data.label);
          }
        }}
      >
        <Background color="#aaa" gap={16} />
      </ReactFlow>
    </div>
  );
});

const LogicMap: React.FC<{ data: any; onClose: () => void }> = ({
  data,
  onClose,
}) => {
  return (
    <div>
      <button onClick={() => onClose()}>Back</button>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
};

const History = ({ history }: { history: any[][] }) => {
  return (
    <div className="history-bar">
      {history.map(([tm, s], idx) => (
        <div key={s + idx}>
          {tm.toLocaleTimeString()}: {s}
        </div>
      ))}
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
        conn.send('map project');
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
    conn.send(`map file ${nodeName}`);
  };

  return (
    <div className="App">
      {fileMap ? (
        <LogicMap data={fileMap} onClose={() => setFileMap(null)} />
      ) : (
        <Mapper includes={projectMap} onClick={onNodeClick} />
      )}
      <History history={history} />
    </div>
  );
};

export default App;
