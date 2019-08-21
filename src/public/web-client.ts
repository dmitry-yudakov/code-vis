declare var webkitSpeechRecognition;
declare var webkitSpeechGrammarList;
declare var webkitSpeechRecognitionEvent;
declare var window;
declare var WebSocket;
declare var vis;

var SpeechRecognition =
    SpeechRecognition ||
    (typeof webkitSpeechRecognition !== 'undefined'
        ? webkitSpeechRecognition
        : undefined);
var SpeechGrammarList =
    SpeechGrammarList ||
    (typeof webkitSpeechGrammarList !== 'undefined'
        ? webkitSpeechGrammarList
        : undefined);
var SpeechRecognitionEvent =
    SpeechRecognitionEvent ||
    (typeof webkitSpeechRecognitionEvent !== 'undefined'
        ? webkitSpeechRecognitionEvent
        : undefined);

var grammar;
const commands = [
    'open',
    'up',
    'down',
    'go back',
    'next',
    'back',
    'отвори',
    'нагоре'
];
const reinitGrammar = (keywords = []) => {
    grammar =
        '#JSGF V1.0; grammar items; public <item> = ' +
        commands.concat(keywords).join(' | ') +
        ' ;';
};
reinitGrammar();

class Recognizer {
    recognition: any;

    constructor(
        protected conf: { onResult; continuous?; interimResults?; lang? }
    ) {}

    start(grammar) {
        this.stop(); // just in case

        let recognition = new SpeechRecognition();
        var speechRecognitionList = new SpeechGrammarList();
        speechRecognitionList.addFromString(grammar, 1);
        console.log('grammar:', grammar);
        recognition.grammars = speechRecognitionList;
        recognition.continuous = this.conf.continuous || false;
        recognition.interimResults = this.conf.interimResults || false;
        recognition.lang = this.conf.lang || 'en-US';
        // recognition.lang = 'bg-BG';
        // recognition.maxAlternatives = 1;
        recognition.onresult = this.onresult.bind(this);
        // recognition.onspeechend = this.onspeechend.bind(this)
        recognition.onend = this.onspeechend.bind(this);
        recognition.onnomatch = this.onnomatch.bind(this);
        recognition.onerror = this.onerror.bind(this);
        recognition.start();

        this.recognition = recognition;
    }

    stop() {
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    static isSupported() {
        return SpeechGrammarList != undefined;
    }

    private onresult(event) {
        // The SpeechRecognitionEvent results property returns a SpeechRecognitionResultList object
        // The SpeechRecognitionResultList object contains SpeechRecognitionResult objects.
        // It has a getter so it can be accessed like an array
        // The [last] returns the SpeechRecognitionResult at the last position.
        // Each SpeechRecognitionResult object contains SpeechRecognitionAlternative objects that contain individual results.
        // These also have getters so they can be accessed like arrays.
        // The [0] returns the SpeechRecognitionAlternative at position 0.
        // We then return the transcript property of the SpeechRecognitionAlternative object
        console.log('results', event.results);
        var last = event.results.length - 1;
        var res = event.results[last][0].transcript;

        console.log('Result received: ' + res);
        console.log('Confidence: ' + event.results[0][0].confidence);
        this.conf.onResult(null, res);

        // console.log('On result - restart')
        // this.recognition.start();
    }

    private onspeechend() {
        if (this.conf.continuous) {
            console.log('On speech end - restart');
            return this.recognition.start();
        }
        this.recognition = null;
    }

    private onnomatch(event) {
        this.conf.onResult('Sorry, I could not understand');
        console.log('No match');
    }

    private onerror(event) {
        this.conf.onResult(event.error);
        console.log('Error occurred in recognition: ' + event.error);
    }
}

const onResult = (err, res) => {
    console.log('Recognized', err, res);
    console.log('Send to websocket');
    appendToHistory('Voice: ' + res);
    if (err) {
        return console.log('Error:', err);
    }
    ws.send(JSON.stringify({ command: res }));
};

const appendToHistory = data => {
    const { document: doc } = window;
    const hitory = doc.getElementById('history');
    const date = new Date();
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const li = doc.createElement('li');
    const newRow = doc.createTextNode(`${date.toLocaleString()}: ${text}`);
    li.appendChild(newRow);
    hitory.appendChild(li);
    li.scrollIntoView();
};

let rec;

const voiceButton = window.document.getElementById('voice-control');
voiceButton.onclick = () => {
    if (rec) {
        appendToHistory('Voice off');
        rec.stop();
        rec = null;
        return;
    }
    rec = new Recognizer({
        continuous: true,
        // interimResults: true, ??
        onResult,
        // lang: 'bg-BG'
        lang: 'en-US'
    });
    rec.start(grammar);
    appendToHistory('Voice on');
};

const input = window.document.getElementById('command-input');
window.document.getElementById('command-form').onsubmit = e => {
    console.log('on submit', e, input.value);
    e.preventDefault();
    const command = input.value;
    ws.send(JSON.stringify({ command }));
    appendToHistory('Input: ' + command);
    input.value = '';
};

const graphDefaultOptions = {
    // locales: {
    //     en: {
    //         edit: 'Edit',
    //         del: 'Delete selected',
    //         back: 'Back',
    //         addNode: 'Add Grouping Node',
    //         addEdge: 'Add Edge',
    //         editNode: 'Edit Node',
    //         editEdge: 'Edit Edge',
    //         addDescription: 'Click in an empty space to place a new node.',
    //         edgeDescription: 'Click on a node and drag the edge to another node to connect them.',
    //         editEdgeDescription: 'Click on the control points and drag them to a node to connect to it.',
    //         createEdgeError: 'Cannot link edges to a cluster.',
    //         deleteClusterError: 'Clusters cannot be deleted.',
    //         editClusterError: 'Clusters cannot be edited.'
    //       }
    // },
    // edges: {
    //     color: "#000000"
    // },
    interaction: {
        hideEdgesOnDrag: true
    },
    nodes: {
        shape: 'box',
        margin: 5,
        widthConstraint: {
            maximum: 200
        },
        shadow: true
    },
    // nodes: {
    //     shape: 'dot',
    // scaling: {
    //     customScalingFunction: function (min, max, total, value) {
    //         console.log('gaga', { min, max, total, value, this_: this });
    //         return value / total;
    //     },
    //     min: 5,
    //     max: 150
    // }
    // },
    // edges: {
    //     font: {
    //         size: 12
    //     },
    //     widthConstraint: {
    //         maximum: 90
    //     }
    // },
    // manipulation: {
    //     enabled: true,
    //     initiallyActive: true,
    //     addNode: (data, cb) => { console.log(data) },
    //     addEdge: (data, cb) => { console.log('add edge', data) },
    //     editNode: (data, cb) => { console.log(data) },
    //     editEdge: (data, cb) => { console.log('edit edge', data) },
    //     deleteNode: (data, cb) => { console.log(data) },
    //     deleteEdge: (data, cb) => { console.log('delete edge', data) },
    //     controlNodeStyle: {
    //         // all node options are valid.
    //     }
    // },
    // physics: {
    //     barnesHut: {
    //         centralGravity: 0.1,
    //     },
    //     minVelocity: 0.75
    // },
    edges: {
        smooth: {
            type: 'continuous'
        }
    },
    physics: false,
    // "physics": {
    //     "minVelocity": 0.75,
    //     "solver": "repulsion"
    // }
    layout: {
        hierarchical: {
            direction: 'LR',
            edgeMinimization: false,
            parentCentralization: false,
            sortMethod: 'directed'
        }
    },
    configure: {
        filter: function(option, path) {
            for (const item of [option, path[0]]) {
                switch (item) {
                    case 'nodes':
                    case 'edges':
                    case 'manipulation':
                        return false;
                }
            }
            return true;
        },
        showButton: false
    }
};

let network;

type Conn = { items: string[]; from: string; to: string };
const renderGraph = (connectionsData: Conn[]) => {
    const nodesObj = {};
    let idx = 0;
    const addUniqueNode = name => {
        const id = (nodesObj[name] = nodesObj[name] || ++idx);
        return id;
    };
    const edges = connectionsData.map(conn => ({
        from: addUniqueNode(conn.from),
        to: addUniqueNode(conn.to),
        arrows: 'from'
    }));
    const nodes = Object.keys(nodesObj).map(label => ({
        id: nodesObj[label],
        label
    }));

    const container = window.document.getElementById('visual');
    const data = {
        nodes: new vis.DataSet(nodes),
        edges: new vis.DataSet(edges)
    };
    if (!network) {
        console.log('init new network with data', connectionsData, data);
        network = new vis.Network(container, data, graphDefaultOptions);

        network.setOptions({ physics: { stabilization: { fit: false } } });
        network.stabilize();

        network.setOptions({ physics: false });
        // network.clusterByHubsize();
    } else {
        console.log(
            'reload existing network with new data',
            connectionsData,
            data
        );
        network.setData(data);
    }
};

let ws;
const reconnectws = () => {
    let protocol = window.location.protocol === 'http:' ? 'ws' : 'wss';
    console.log('connect websocket');
    ws = new WebSocket(`${protocol}://${window.location.host}`);
    ws.onopen = () => {
        appendToHistory('Connected');
        ws.send(JSON.stringify({ command: 'map project' }));
    };
    ws.onclose = () =>
        setTimeout(() => {
            console.log('reconnect websocket');
            reconnectws();
        }, 1000);
    ws.onmessage = e => {
        console.log('ws message received', e.data);
        let msg = JSON.parse(e.data);
        switch (msg.type) {
            case 'keywords':
                reinitGrammar(msg.payload);
                appendToHistory('Keywords received');
                break;
            case 'projectMap':
                // appendToHistory(msg.payload);
                appendToHistory('Project map received');
                renderGraph(msg.payload);
                break;
            case 'info':
                appendToHistory(msg.payload);
                break;
            default:
                appendToHistory('Unrecognized: ' + JSON.stringify(msg));
        }
        // rec.start(grammar)
    };
};
reconnectws();
