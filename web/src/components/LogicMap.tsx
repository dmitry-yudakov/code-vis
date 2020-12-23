import React, { useState } from 'react';
import { IconButton } from '@material-ui/core';
import { ExpandLess, ExpandMore } from '@material-ui/icons';
import Grow from '@material-ui/core/Grow';
import {
  FileIncludeInfo,
  FileMapDetailed,
  FileMapping,
  FunctionCallInfo,
  FunctionDeclarationInfo,
} from '../types';
import {
  applyGraphLayout,
  buildNodesTree,
  findRelatedFiles,
  funcCallSlug,
  funcDeclSlug,
  funcDeclSlugFromPieces,
} from '../utils';
import { CloseButton } from '../atoms';
import ReactFlow, {
  Edge as ReactFlowEdge,
  Controls,
  // Handle,
  Position,
} from 'react-flow-renderer';
import './LogicMap.css';
import cx from 'clsx';
import {
  MonacoEditorProvider as CodeViewProvider,
  useFuncCall,
} from './MonacoEditor';
// import {
//   CodeMirrorProvider as CodeViewProvider,
//   useFuncCall,
//   useFuncDecl,
// } from './CodeMirror';

export enum LogicNodeType {
  file,
  code,
  call,
  decl,
}
export interface LogicNode {
  type: LogicNodeType;
  value: string | FunctionDeclarationInfo | FunctionCallInfo;
  pos: number;
  end: number;
  children: LogicNode[];
}

// const FuncDeclHandle: FC<{ func: FunctionDeclarationInfo }> = ({ func }) => {
//   const handleId = funcDeclSlug(func);
//   return (
//     <Handle
//       type="target"
//       className="func-decl-handle"
//       position={Position.Left}
//       id={handleId}
//     />
//   );
// };

// const FuncCallHandle: FC<{ func: FunctionCallInfo }> = ({ func }) => {
//   const handleId = funcCallSlug(func);
//   return (
//     <Handle
//       type="source"
//       className="func-call-handle"
//       position={Position.Right}
//       // position={Position.Top}
//       id={handleId}
//     />
//   );
// };

const renderChildren = (
  content: string,
  children: LogicNode[],
  parentDeclaration?: FunctionDeclarationInfo
) => {
  return children.map((child) => {
    const { type, pos, end, value } = child;

    const body = content.slice(pos, end);
    const key = `${pos}-${end}`;
    const children = renderChildren(
      content,
      child.children,
      child.type === LogicNodeType.decl
        ? (child.value as FunctionDeclarationInfo)
        : parentDeclaration
    );

    switch (type) {
      case LogicNodeType.code:
        return (
          <SimpleCode key={key} code={body}>
            {/* {children} */}
          </SimpleCode>
        );
      case LogicNodeType.decl:
        return (
          <FunctionInnerDeclarationView
            key={key}
            func={value as FunctionDeclarationInfo}
            content={content}
            innerNodes={child.children}
          >
            {children}
          </FunctionInnerDeclarationView>
        );
      case LogicNodeType.call:
        return (
          <FunctionCallView
            key={key}
            func={value as FunctionCallInfo}
            content={content}
            parent={parentDeclaration || null}
          >
            {children}
          </FunctionCallView>
        );
      default:
        return <div>WTF</div>;
    }
  });
};

const FunctionCallView: React.FC<{
  func: FunctionCallInfo;
  parent: FunctionDeclarationInfo | null;
  content: string;
}> = ({ func, content, parent, children }) => {
  useFuncCall(func, parent);

  return (
    <>
      {/* <div ref={ref} className="func-call-handle-wrapper">
        <FuncCallHandle func={func} />
      </div> */}
      {children}
    </>
  );
};

const FunctionInnerDeclarationView: React.FC<{
  func: FunctionDeclarationInfo;
  innerNodes: LogicNode[];
  content: string;
}> = ({ func, content, innerNodes, children }) => {
  // const [expand, setExpand] = useState(false);
  // const ref = useInnerFuncDecl(func);

  return (
    <>
      {/* <div ref={ref}>
        <FuncDeclHandle func={func} />
      </div> */}
      {renderChildren(content, innerNodes)}
    </>
  );
};

const SimpleCode: React.FC<{ code: string }> = ({ code }) => {
  return <span />;
};

export const generateConnections = (
  fd: FunctionDeclarationInfo,
  functionCalls: FunctionCallInfo[],
  mapping: FileMapping,
  uniqIdx: number
) => {
  const includedItems = new Set(mapping.includes.flatMap((incl) => incl.items));
  const declaredItems = new Set(
    mapping.functionDeclarations.flatMap((decl) => decl.name)
  );

  const mainFileCalls = functionCalls
    .filter((fc) => includedItems.has(fc.name) || declaredItems.has(fc.name))
    .map((fc) => {
      const { name } = fc;

      const sourceHandle = funcCallSlug(fc);
      const source = funcDeclSlug(fd);
      const fdFilename = includedItems.has(name)
        ? mapping.includes.find((incl) => incl.items.includes(name))!.from
        : fd.filename;

      const targetHandle = funcDeclSlugFromPieces(fdFilename, name);

      return {
        id: `${sourceHandle}-${targetHandle}-${uniqIdx}`,
        source,
        sourceHandle,
        target: targetHandle,
      };
    });

  return mainFileCalls;
};

const FunctionDeclarationView: React.FC<{
  func: FunctionDeclarationInfo;
  innerNodes: LogicNode[];
  content: string;
  onScroll?: () => void;
}> = ({ func, content, innerNodes, onScroll }) => {
  const [expand, setExpand] = useState(true);

  const handleExpandCollapse = () => {
    setExpand(!expand);
    onScroll?.();
  };

  const { name, args, filename } = func;
  const shortView = (
    <span className="func-decl-title">
      func <strong>{name}</strong> ({args.join(', ')}) - {filename}
    </span>
  );

  return (
    <div
      className={cx('func-decl', expand && 'expanded')}
      title={`${name} - ${filename}`}
      style={{ width: expand ? 500 : undefined }}
    >
      <IconButton
        size="small"
        className="expand-collapse"
        onClick={handleExpandCollapse}
      >
        {expand ? <ExpandLess /> : <ExpandMore />}
      </IconButton>

      {expand ? (
        <Grow in={expand}>
          <div>
            <div className="filename">{filename}</div>
            <CodeViewProvider
              content={content.slice(func.pos, func.end)}
              onScroll={onScroll}
            >
              {renderChildren(content, innerNodes, func)}
            </CodeViewProvider>
          </div>
        </Grow>
      ) : (
        shortView
      )}
    </div>
  );
};

export const LogicMap: React.FC<{
  filename: string;
  projectMap: FileIncludeInfo[];
  onRequestRelatedFile: (filename: string) => FileMapDetailed | null;
  onClose: () => void;
}> = ({
  filename: startFilename,
  projectMap,
  onRequestRelatedFile,
  onClose,
}) => {
  const relatedFiles = findRelatedFiles(startFilename, projectMap);
  const allMappingsByFilename = {
    [startFilename]: onRequestRelatedFile(startFilename),
    ...Object.fromEntries(
      relatedFiles.map((flnm) => [flnm, onRequestRelatedFile(flnm)])
    ),
  };
  const allMappings = Object.values(allMappingsByFilename).filter(
    (mapping) => !!mapping
  ) as FileMapDetailed[];

  // const [refreshTicker, setRefresh] = useState(0);
  // console.log('refreshTicker', refreshTicker);

  const showConnections = true;
  // const [showConnections, setShowConnections] = useState(false);
  // useEffect(() => {
  //   setTimeout(() => setShowConnections(true), 2000);
  // }, []);

  const elements = allMappings.flatMap((fileDetails, fileIdx) => {
    if (!fileDetails) return [];
    const { content, mapping } = fileDetails;
    const { functionDeclarations, functionCalls } = dropUnmatchedFunctionCalls(
      mapping
    );

    const fileStruct = buildNodesTree(
      functionDeclarations,
      functionCalls,
      content.length
    );

    return fileStruct.children
      .filter((it) => it.type === LogicNodeType.decl)
      .flatMap((node, idx) => {
        const func = node.value as FunctionDeclarationInfo;

        const connections = generateConnections(
          func,
          node.children
            .filter((n) => n.type === LogicNodeType.call)
            .map((node) => node.value as FunctionCallInfo), // TODO search recursive
          mapping,
          0 //refreshTicker
        );

        return [
          {
            id: funcDeclSlug(func),
            data: {
              label: (
                <FunctionDeclarationView
                  func={func}
                  content={content}
                  innerNodes={node.children}
                  // onScroll={() => setRefresh((i) => i + 1)}
                >
                  {content.slice(func.pos, func.end)}
                </FunctionDeclarationView>
              ),
            },
            style: {
              // width: mainWidth,
              width: 'unset',
            },
            position: {
              x: 0,
              y: 0,
              // x: 10 + fileIdx * 600 + idx * 10,
              // y: 10 + idx * 30,
            },
            targetPosition: Position.Left,
            sourcePosition: Position.Right,
          },
          ...connections,
        ];
      });
  });

  // const
  applyGraphLayout(
    () =>
      elements
        .filter((e: any) => !!e.position)
        .map((e) => ({ id: e.id, label: e.id, __originalNode: e })),
    () => elements.filter((e: any) => e.source && e.target) as ReactFlowEdge[],
    (n: any, x, y) => {
      n.__originalNode.position.x = x;
      n.__originalNode.position.y = y;
    },
    650,
    150,
    'LR'
  );

  console.log('Elements', elements);
  return (
    <div className="logic-map-main">
      <TopLeftCloseButton onClose={onClose} />
      <ReactFlow
        elements={
          showConnections ? elements : elements.filter((e: any) => !e.source)
        }
        nodesConnectable={false}
        // nodesDraggable={false}
        zoomOnScroll={true}
        // panOnScroll={true}
        onlyRenderVisibleElements={false}
      >
        <Controls />
      </ReactFlow>
    </div>
  );
};

const TopLeftCloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 5 }}>
      <CloseButton onClick={onClose} />
    </div>
  );
};

function dropUnmatchedFunctionCalls(mapping: FileMapping): FileMapping {
  const includedItems = new Set(mapping.includes.flatMap((incl) => incl.items));
  const declaredItems = new Set(
    mapping.functionDeclarations.flatMap((decl) => decl.name)
  );
  const filteredMapping = {
    ...mapping,
    functionCalls: mapping.functionCalls.filter(
      (fc) => includedItems.has(fc.name) || declaredItems.has(fc.name)
    ),
  };

  return filteredMapping;
}
