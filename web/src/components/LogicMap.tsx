import React from 'react';
import {
  FileIncludeInfo,
  FileMapDetailed,
  FunctionDeclarationInfo,
} from '../types';
import './LogicMap.css';

const key = (pos: number, end: number) => `${pos}-${end}`;

const enrichContent = (
  content: string,
  functionDeclarations: FunctionDeclarationInfo[]
) => {
  let prevIdx = 0;
  const items: any[] = [];
  for (const fd of functionDeclarations) {
    const { pos, end, name } = fd;

    if (prevIdx > pos) {
      console.log('Must be nested function - currently not supported', fd);
      continue;
    }

    if (prevIdx < pos) {
      items.push(
        <span className="simple-code" key={key(prevIdx, pos)}>
          {content.slice(prevIdx, pos)}
        </span>
      );
    }
    const body = content.slice(pos, end);
    items.push(
      <span className="func-decl" key={key(pos, end)} title={name}>
        {body}
      </span>
    );
    prevIdx = end;
  }
  if (prevIdx < content.length) {
    items.push(
      <span key={key(prevIdx, content.length)}>
        {content.slice(prevIdx, content.length)}
      </span>
    );
  }
  return items;
};

export const LogicMap: React.FC<{
  data: FileMapDetailed;
  filename: string;
  projectMap: FileIncludeInfo[];
  onClose: () => void;
}> = ({ data, filename, projectMap, onClose }) => {
  const { content, mapping } = data;

  const includes = projectMap.filter((incl) => incl.to === filename);
  const includedIn = projectMap.filter((incl) => incl.from === filename);

  const { functionDeclarations, functionCalls } = mapping;
  console.log({ functionDeclarations, functionCalls });

  const fileContent = enrichContent(content, functionDeclarations);

  return (
    <div>
      <button onClick={() => onClose()}>Back</button>
      <div>
        <h2>{filename}</h2>
        <h3>Includes</h3>
        {includes.map((incl, idx) => (
          <div key={incl.from + idx}>
            {incl.items.join(',')} from <strong>{incl.to}</strong>
          </div>
        ))}
      </div>
      <div>
        <h3>Referenced in</h3>
        {includedIn.map((incl, idx) => (
          <div key={incl.from + idx}>
            <strong>{incl.to}</strong>: {incl.items.join(',')}
          </div>
        ))}
      </div>
      <div className="logic-map-panes">
        <div className="content">
          <h3>Content</h3>
          {/* {content} */}
          {fileContent}
        </div>
        <div className="mapping">
          <h3>Mapping</h3>
          {JSON.stringify(mapping, null, 2)}
        </div>
      </div>
    </div>
  );
};
