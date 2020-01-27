import React, { useState, useEffect, useMemo, useRef } from 'react';
import './App.css';
import { WSConn } from './connection';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import Backend from 'react-dnd-html5-backend';

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
    const absLeft = window.scrollX + left;
    const absTop = window.scrollY + top;
    const x = absLeft + width / 2;
    const y = absTop + height / 2;
    console.debug(
        { absLeft, absTop, left, top, width, height, x, y },
        window.scrollX,
        window.scrollY
    );
    return [x, y];
};

const Node = ({ forwardRef, children, onChange }: any) => {
    const [, drag] = useDrag({
        item: { type: 'NODE' },
        end: (type, monitor) => {
            console.log('Node drop ended', type, monitor.getDropResult());
            console.log(
                'Node drop end offsets',
                monitor.getInitialClientOffset(),
                monitor.getInitialSourceClientOffset(),
                monitor.getClientOffset(),
                monitor.getDifferenceFromInitialOffset(),
                monitor.getSourceClientOffset(),
                monitor.getClientOffset()
            );
            const moveResult = monitor.getDropResult();
            if (moveResult) {
                onChange(moveResult);
            }
        },
        collect: monitor => ({
            isDragging: !!monitor.isDragging()
        })
    });
    return (
        <div className="node" ref={forwardRef}>
            <div ref={drag}>{children}</div>
        </div>
    );
};

const DND = ({ children }: any) => {
    const [, drop] = useDrop({
        accept: 'NODE',
        drop: (type, monitor) => {
            console.log(
                'drop',
                monitor.getInitialClientOffset(),
                monitor.getInitialSourceClientOffset(),
                monitor.getClientOffset(),
                monitor.getDifferenceFromInitialOffset(),
                monitor.getSourceClientOffset(),
                monitor.getClientOffset()
            );
            return monitor.getSourceClientOffset();
        }
    });
    return (
        <div className="mapper" ref={drop}>
            {children}
        </div>
    );
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
            el.style.left = `${rand(width - 250)}px`;
            el.style.top = `${rand(height - 50)}px`;
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

    const updateNodePosition = (
        name: string,
        pos: { x: number; y: number }
    ) => {
        const ref = nodesRefs[name];
        const el: any = ref.current;
        const x = pos.x + window.scrollX;
        const y = pos.y + window.scrollY;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        setNodesChange(nodesChange + 1);
    };

    return (
        <div className="mapper" ref={mapperRef}>
            <DndProvider backend={Backend}>
                <DND>
                    {nodes.map(([name, includes]) => {
                        return (
                            <Node
                                key={name}
                                forwardRef={nodesRefs[name]}
                                onChange={(res: any) =>
                                    updateNodePosition(name, res)
                                }
                            >
                                {name} ({includes.length})
                            </Node>
                        );
                    })}
                    {nodes.map(([name, includes]) => {
                        return includes.map((incl, idx) => {
                            const key = includeKey(incl);

                            return (
                                <div
                                    className="edge"
                                    key={key}
                                    ref={edgesRefs[key]}
                                >
                                    <div className="edge-label">
                                        {incl.items.join(', ')}
                                    </div>
                                </div>
                            );
                        });
                    })}
                </DND>
            </DndProvider>
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
