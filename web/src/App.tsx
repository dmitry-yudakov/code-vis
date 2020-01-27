import React, { useState, useEffect, useMemo, useRef } from 'react';
import './App.css';
import { WSConn } from './connection';

const url = `ws://localhost:3789`;

interface Include {
    items: string[];
    to: string;
    from: string;
}

const rand = (upperLimit: number) => Math.floor(Math.random() * upperLimit);
const includeKey = (incl: Include) =>
    `${incl.from}-${incl.to}-${incl.items.join('|')}`;
const center = (node: any) => {
    const {
        left,
        top,
        // right,
        // bottom,
        // x,
        // y,
        width,
        height
    } = node.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    // console.log({ left, top, right, bottom, width, height, x, y });
    return [x, y];
};

const Mapper = React.memo(({ includes }: { includes: Include[] }) => {
    const [nodesMap, edgesMap, nodes] = useMemo(() => {
        const nodesMap: { [node: string]: Include[] } = {};
        const edgesMap: { [node: string]: Include } = {};
        for (const ii of includes) {
            const key = ii.to;
            const key2 = ii.from;

            const pp = nodesMap[key] || [];
            pp.push(ii);

            nodesMap[key] = pp;
            nodesMap[key2] = nodesMap[key2] || [];

            edgesMap[includeKey(ii)] = ii;
        }
        const nodes = Object.entries(nodesMap).sort(
            (l, r) => r[1].length - l[1].length
        );
        return [nodesMap, edgesMap, nodes];
    }, [includes]);

    const [nodesRefs, edgesRefs] = useMemo(() => {
        const nodesRefs: { [s: string]: React.RefObject<HTMLDivElement> } = {};
        const edgesRefs: { [s: string]: React.RefObject<HTMLDivElement> } = {};
        for (const [name, includes] of nodes) {
            nodesRefs[name] = React.createRef<HTMLDivElement>();
            for (const incl of includes) {
                const key = includeKey(incl);
                edgesRefs[key] = React.createRef<HTMLDivElement>();
            }
        }
        return [nodesRefs, edgesRefs];
    }, [nodes]);

    const mapperRef = useRef<HTMLDivElement>(null);

    const [nodesChange, setNodesChange] = useState(0);
    useEffect(() => {
        console.log('Reposition nodes');
        const mapperEl = mapperRef.current as any;
        const { height, width } = mapperEl.getBoundingClientRect();
        // console.log('Mapper size', { height, width });
        for (const [key] of nodes) {
            const ref = nodesRefs[key];
            const el: any = ref.current;
            el.style.left = `${rand(width)}px`;
            el.style.top = `${rand(height)}px`;
            // console.log(el, el.style);
        }
        // setNodesChange(nodesChange + 1);
    }, [nodes, nodesRefs]);

    useEffect(() => {
        console.log('Reposition edges');
        for (const key in edgesMap) {
            const ref = edgesRefs[key];
            const el: any = ref.current;
            const edge = edgesMap[key];
            const node1Ref = nodesRefs[edge.from];
            const node2Ref = nodesRefs[edge.to];
            const [x1, y1] = center(node1Ref.current);
            const [x2, y2] = center(node2Ref.current);
            console.debug(key, edge, { x1, y1, x2, y2 });
            const top = Math.min(y1, y2);
            const left = Math.min(x1, x2);
            el.style.top = `${top}px`;
            el.style.left = `${left}px`;
            el.style.width = `${Math.abs(x1 - x2)}px`;
            el.style.height = `${Math.abs(y1 - y2)}px`;
            if ((top === y1 && left === x1) || (top === y2 && left === x2)) {
                el.classList.add('up');
                el.classList.remove('down');
            } else {
                el.classList.add('down');
                el.classList.remove('up');
            }
        }
    }, [nodesChange, nodesRefs, edgesMap, edgesRefs]);

    return (
        <div className="mapper" ref={mapperRef}>
            {nodes.map(([name, includes]) => {
                return (
                    <div className="node" key={name} ref={nodesRefs[name]}>
                        {name} ({includes.length})
                    </div>
                );
            })}
            {nodes.map(([name, includes]) => {
                return includes.map((incl, idx) => {
                    const key = includeKey(incl);

                    return (
                        <div className="edge" key={key} ref={edgesRefs[key]}>
                            <div className="edge-label">
                                {incl.items.join(', ')}
                            </div>
                        </div>
                    );
                });
            })}
        </div>
    );
});

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
    const [history, setHistory] = useState<any[][]>([]);
    const appendToHistory = (str: string) =>
        setHistory(hist => [...hist, [new Date(), str]]);

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
    }, []);
    return (
        <div className="App">
            <Mapper includes={projectMap} />
            <History history={history} />
        </div>
    );
};

export default App;
