export class WSConn {
  ws: WebSocket;

  constructor(
    public url: string,
    public onMessage: (type: string, payload: object) => void,
    public onOpen: () => void
  ) {
    this.ws = this.reconnectws();
  }

  send(command: string, payload?: object) {
    this.ws.send(JSON.stringify({ type: command, payload }));
  }

  reconnectws() {
    // let protocol = window.location.protocol === 'http:' ? 'ws' : 'wss';
    console.log('connect websocket');
    // const ws = new WebSocket(`${protocol}://${window.location.host}`);
    const ws = new WebSocket(this.url);
    ws.onopen = this.onOpen;
    // this.ws.onopen = () => {
    // appendToHistory('Connected');
    // this.ws.send(JSON.stringify({ command: 'map project' }));
    // };
    ws.onclose = () =>
      setTimeout(() => {
        console.log('reconnect websocket');
        this.ws = this.reconnectws();
      }, 1000);
    ws.onmessage = (e) => {
      console.log('ws message received', e.data);
      let msg = JSON.parse(e.data);
      this.onMessage(msg.type, msg.payload);
      // switch (msg.type) {
      //     case 'keywords':
      //         reinitGrammar(msg.payload);
      //         appendToHistory('Keywords received');
      //         break;
      //     case 'projectMap':
      //         // appendToHistory(msg.payload);
      //         appendToHistory('Project map received');
      //         projectMapData = msg.payload;
      //         renderGraph(msg.payload);
      //         break;
      //     case 'info':
      //         appendToHistory(msg.payload);
      //         break;
      //     default:
      //         appendToHistory('Unrecognized: ' + JSON.stringify(msg));
      // }
      // rec.start(grammar)
    };
    return ws;
  }
}

// }
// let ws;
// export const ;
// ws = reconnectws();
