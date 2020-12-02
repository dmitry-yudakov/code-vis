import React, { useState } from 'react';
import {
  FileIncludeInfo,
  FileMapDetailed,
  FunctionCallInfo,
  FunctionDeclarationInfo,
} from '../types';
import { isEmptyContent } from '../utils';
import { FilenamePrettyView } from './FilenamePrettyView';
import './LogicMap.css';

enum LogicNodeType {
  file,
  code,
  call,
  decl,
}

interface LogicNode {
  type: LogicNodeType;
  value: string | FunctionDeclarationInfo | FunctionCallInfo;
  pos: number;
  end: number;
  children: LogicNode[];
}

const buildNodesTree = (
  functionDeclarations: FunctionDeclarationInfo[],
  functionCalls: FunctionCallInfo[],
  contentSize: number
): LogicNode => {
  const nodes: LogicNode[] = [
    // whole file - root node
    {
      type: LogicNodeType.file,
      pos: 0,
      end: contentSize,
      children: [],
      value: '',
    },

    // decls
    ...functionDeclarations.map((f) => ({
      type: LogicNodeType.decl,
      value: f,
      pos: f.pos,
      end: f.end,
      children: [],
    })),

    // calls
    ...functionCalls.map((f) => ({
      type: LogicNodeType.call,
      value: f,
      pos: f.pos,
      end: f.end,
      children: [],
    })),
  ].sort((l, r) => l.pos - r.pos);
  // console.log('NODES:', funcs);

  const emplaceCurrentNode = (currentIndex: number) => {
    const current = nodes[currentIndex];

    for (
      let reverseSearchIndex = currentIndex - 1;
      reverseSearchIndex >= 0;
      --reverseSearchIndex
    ) {
      const potentialParent = nodes[reverseSearchIndex];
      if (
        potentialParent.pos < current.pos &&
        current.end < potentialParent.end
      ) {
        potentialParent.children.push(current);
        return;
      }
    }
    console.log('WTF, cannot emplace current node', { i: currentIndex, nodes });
  };

  for (let currentIndex = 1; currentIndex < nodes.length; ++currentIndex) {
    emplaceCurrentNode(currentIndex);
  }

  const fillGaps = (node: LogicNode) => {
    let currentPos = node.pos;
    const enrichedChildren = [];

    for (const child of node.children) {
      if (child.pos > currentPos) {
        enrichedChildren.push({
          type: LogicNodeType.code,
          pos: currentPos,
          end: child.pos,
          value: 'FILL LATER',
          children: [],
        });
      }

      enrichedChildren.push(child);
      currentPos = child.end;
    }

    if (currentPos < node.end) {
      enrichedChildren.push({
        type: LogicNodeType.code,
        pos: currentPos,
        end: node.end,
        value: 'FILL LATER',
        children: [],
      });
    }

    node.children = enrichedChildren;
  };

  nodes.forEach(fillGaps);

  // console.log('STRUCTURED NODES', nodes[0], nodes);

  return nodes[0];
};

const renderChildren = (content: string, children: LogicNode[]) => {
  return children.map((child) => {
    const { type, pos, end, value } = child;

    const body = content.slice(pos, end);
    const key = `${pos}-${end}`;
    const children = renderChildren(content, child.children);

    switch (type) {
      case LogicNodeType.code:
        return (
          <SimpleCode key={key} code={body}>
            {/* {children} */}
          </SimpleCode>
        );
      case LogicNodeType.decl:
        return (
          <FunctionDeclarationView
            key={key}
            func={value as FunctionDeclarationInfo}
            body={body}
          >
            {children}
          </FunctionDeclarationView>
        );
      case LogicNodeType.call:
        return (
          <FunctionCallView
            key={key}
            func={value as FunctionCallInfo}
            body={body}
          >
            {children}
          </FunctionCallView>
        );
      default:
        return <div>WTF</div>;
    }
  });
};

const FunctionCallView: React.FC<{ func: FunctionCallInfo; body: string }> = ({
  // func,
  body,
  // children,
}) => {
  return <div className="func-call">{body}</div>;
};

const FunctionDeclarationView: React.FC<{
  func: FunctionDeclarationInfo;
  body: string;
}> = ({ func, body, children }) => {
  const [expand, setExpand] = useState(true);
  const { name, args } = func;
  const shortView = `func ${name} (${args.join(', ')}) ...`;
  return (
    <div className="func-decl" title={name} onClick={() => setExpand(!expand)}>
      {expand ? children : shortView}
    </div>
  );
};

const SimpleCode: React.FC<{ code: string }> = ({ code }) => {
  const [expand, setExpand] = useState(true);
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

  const fileStruct = buildNodesTree(
    functionDeclarations,
    functionCalls,
    content.length
  );
  const fileContent = renderChildren(content, fileStruct.children);

  console.log({ functionDeclarations, functionCalls });
  return (
    <div className="file-view">
      <div className="file-view-heading">
        <FilenamePrettyView filename={filename} />
      </div>
      {fileContent}
    </div>
  );
};

const HiddenRelatedFile: React.FC<{ filename: string }> = ({ filename }) => {
  return <div className="hidden-file">{filename} hidden</div>;
};

export const LogicMap: React.FC<{
  data: FileMapDetailed;
  filename: string;
  projectMap: FileIncludeInfo[];
  onRequestRelatedFile: (filename: string) => FileMapDetailed | null;
  onClose: () => void;
}> = ({ data, filename, projectMap, onRequestRelatedFile, onClose }) => {
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
            {incl.items.join(',')} from <strong>{incl.from}</strong>
          </div>
        ))}
      </div>
      <div>
        <h3>Referenced in</h3>
        {includedIn.map((incl, idx) => (
          <div key={incl.to + idx}>
            <strong>{incl.to}</strong>: {incl.items.join(',')}
          </div>
        ))}
      </div>
      <div className="logic-map-panes">
        <div className="content">
          <div className="references">
            <h3>References</h3>
            {includedIn.map((incl, idx) => {
              const fn = incl.to;
              const data = onRequestRelatedFile(fn);
              return data ? (
                <FileView key={fn + idx} fileDetails={data} filename={fn} />
              ) : (
                <HiddenRelatedFile key={fn + idx} filename={fn} />
              );
            })}
          </div>
          <div className="main-content">
            <h3>Content</h3>
            <FileView fileDetails={data} filename={filename} />
          </div>
          <div className="includes">
            <h3>Includes</h3>
            {includes.map((incl, idx) => {
              const fn = incl.from;
              const data = onRequestRelatedFile(fn);
              return data ? (
                <FileView key={fn + idx} fileDetails={data} filename={fn} />
              ) : (
                <HiddenRelatedFile key={fn + idx} filename={fn} />
              );
            })}
          </div>
        </div>
        <div className="mapping">
          <h3>Mapping</h3>
          {JSON.stringify(mapping, null, 2)}
        </div>
      </div>
    </div>
  );
};
