import React, { useState } from 'react';
import {
  FileIncludeInfo,
  FileMapDetailed,
  FunctionDeclarationInfo,
} from '../types';
import { isEmptyContent } from '../utils';
import './LogicMap.css';

const key = (pos: number, end: number) => `${pos}-${end}`;

const enrichContent = (
  content: string,
  functionDeclarations: FunctionDeclarationInfo[]
) => {
  let prevIdx = 0;
  const items: any[] = [];
  for (const fd of functionDeclarations) {
    const { pos, end } = fd;

    if (prevIdx > pos) {
      console.log('Must be nested function - currently not supported', fd);
      continue;
    }

    if (prevIdx < pos) {
      items.push(
        <SimpleCode
          key={key(prevIdx, pos)}
          code={content.slice(prevIdx, pos)}
        />
      );
    }
    const body = content.slice(pos, end);
    items.push(<FunctionView func={fd} body={body} key={key(pos, end)} />);
    prevIdx = end;
  }
  if (prevIdx < content.length) {
    items.push(
      <SimpleCode
        key={key(prevIdx, content.length)}
        code={content.slice(prevIdx, content.length)}
      />
    );
  }
  return items;
};

const FunctionView: React.FC<{
  func: FunctionDeclarationInfo;
  body: string;
}> = ({ func, body }) => {
  const [expand, setExpand] = useState(false);
  const { name, args } = func;
  const shortView = `func ${name} (${args.join(', ')}) ...`;
  return (
    <div className="func-decl" title={name} onClick={() => setExpand(!expand)}>
      {expand ? body : shortView}
    </div>
  );
};

const SimpleCode: React.FC<{ code: string }> = ({ code }) => {
  const [expand, setExpand] = useState(false);
  if (isEmptyContent(code)) return <span />;

  const linesCount = code.match(/\n/g)?.length || 1;
  const shortView = `code... ${linesCount} lines`;
  return (
    <div className="simple-code" onClick={() => setExpand(!expand)}>
      {expand ? code : shortView}
    </div>
  );
};

const FileView: React.FC<{
  fileDetails: FileMapDetailed;
  filename: string;
}> = ({ fileDetails, filename }) => {
  const { content, mapping } = fileDetails;
  const { functionDeclarations, functionCalls } = mapping;
  const fileContent = enrichContent(content, functionDeclarations);

  console.log({ functionDeclarations, functionCalls });
  return (
    <div className="file-view">
      <h3>{filename}</h3>
      {fileContent}
    </div>
  );
};

export const LogicMap: React.FC<{
  data: FileMapDetailed;
  filename: string;
  projectMap: FileIncludeInfo[];
  onClose: () => void;
}> = ({ data, filename, projectMap, onClose }) => {
  const { mapping } = data;

  const includes = projectMap.filter((incl) => incl.to === filename);
  const includedIn = projectMap.filter((incl) => incl.from === filename);

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
          <FileView fileDetails={data} filename={filename} />
        </div>
        <div className="mapping">
          <h3>Mapping</h3>
          {JSON.stringify(mapping, null, 2)}
        </div>
      </div>
    </div>
  );
};
