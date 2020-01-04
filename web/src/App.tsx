import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import { WSConn } from './connection';

const url = `ws://localhost:3789`;

interface Include {
    items: string[];
    to: string;
    from: string;
}

const Mapper = ({ includes }: { includes: Include[] }) => {
    return (
        <div className="mapper">
            {includes.map((incl, idx) => (
                <div key={incl.to + '-' + incl.from + idx}>
                    {JSON.stringify(incl)}
                </div>
            ))}
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
