import { WSConn } from './connection';

let conn: WSConn;

export interface InitConnectionProps {
  url: string;
  onOpen: () => void;
  onMessage: (type: string, payload: object) => void;
}

export const initConnection = ({
  url,
  onOpen,
  onMessage,
}: InitConnectionProps) => {
  conn = new WSConn(url, onMessage, onOpen);
};

export const sendToServer = (command: string, payload?: object) => {
  if (!conn) {
    console.log(
      'Cannot send',
      command,
      '- no connection to server. Try again in a sec'
    );
    setTimeout(() => sendToServer(command, payload), 500);
    return;
  }
  conn.send(command, payload);
};
