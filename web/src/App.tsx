import React, { useState, useEffect, useRef } from 'react';
import ReactFlow, { ArrowHeadType, Background } from 'react-flow-renderer';
import './App.css';
import { WSConn } from './connection';
import { History } from './components/History';
import { FileMapping, Include } from './types';
import { extractNodes, getNodesObj, rand } from './utils';

const url = `ws://localhost:3789`;


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
        nodesConnectable={false}
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
        <Mapper includes={projectMap} onClick={onNodeClick} />
      )}
      <History history={history} />
    </div>
  );
};

export default App;
