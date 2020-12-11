import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileIncludeInfo,
  FileMapDetailed,
  FileMapping,
  FunctionCallInfo,
  FunctionDeclarationInfo,
} from '../types';
import {
  buildNodesTree,
  dropIrrelevantFunctionCalls,
  funcCallSlug,
  funcDeclSlug,
  funcDeclSlugFromPieces,
} from '../utils';
import { FilenamePrettyView } from './FilenamePrettyView';
import ReactFlow, {
  // ArrowHeadType,
  // Background,
  Controls,
  Handle,
  Position,
} from 'react-flow-renderer';
import { UnControlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/material.css';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/javascript/javascript';
import './LogicMap.css';

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

const CodeMirrorContext = React.createContext<any>(null);
const CodeMirrorProvider: React.FC<{ content: string }> = ({
  content,
  children,
}) => {
  const [inst, setInst] = useState(null);
  return (
    <>
      <CodeMirror
        editorDidMount={(editor) => setInst(editor)}
        value={content}
        options={{
          mode: 'javascript',
          lineNumbers: true,
          lineWrapping: true,
        }}
        // onChange={(editor, data, value) => {
        // }}
      />
      <CodeMirrorContext.Provider value={inst}>
        {children}
      </CodeMirrorContext.Provider>
    </>
  );
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
  func,
  body,
  children,
}) => {
  const handleId = funcCallSlug(func);

  const ref = useRef<any>();
  const cm = useContext(CodeMirrorContext);

  const el = ref.current;
  const { pos, end } = func;
  useEffect(() => {
    // console.log('FunctionCallView', { pos, end, cm, el });

    if (!cm || !el) return;

    // underline
    cm.markText(cm.posFromIndex(pos), cm.posFromIndex(end), {
      className: 'func-call-2',
    });

    // handle
    cm.addWidget(cm.posFromIndex(end), el);
  }, [cm, el, pos, end]);

  return (
    <>
      <div ref={ref}>
        <Handle
          type="source"
          className="func-call-handle"
          position={Position.Right}
          id={handleId}
        />
        {/* {body} */}
      </div>
      {children}
    </>
  );
};

const FunctionDeclarationView: React.FC<{
  func: FunctionDeclarationInfo;
  body: string;
}> = ({ func, children }) => {
  // const [expand, setExpand] = useState(true);
  // const { name, args } = func;
  // const shortView = `func ${name} (${args.join(', ')}) ...`;

  const handleId = funcDeclSlug(func);

  const ref = useRef<any>();
  const cm = useContext(CodeMirrorContext);

  const el = ref.current;
  const { pos, end } = func;
  useEffect(() => {
    // console.log('FunctionDeclarationView', { pos, end, cm, el });

    if (!cm || !el) return;

    // underline
    cm.markText(cm.posFromIndex(pos), cm.posFromIndex(end), {
      // className: 'func-decl-2',
      startStyle: 'func-decl-2',
    });

    // handle
    cm.addWidget(cm.posFromIndex(pos), el);
  }, [cm, el, pos, end]);

  return (
    // <div className="func-decl" title={name} onClick={() => setExpand(!expand)}>
    <>
      <div ref={ref}>
        <Handle
          type="target"
          className="func-decl-handle"
          position={Position.Left}
          id={handleId}
        />
        {/* {expand ? children : shortView} */}
      </div>
      {children}
    </>
  );
};

const SimpleCode: React.FC<{ code: string }> = ({ code }) => {
  return <span />;
  // const [expand, setExpand] = useState(true);
  // if (isEmptyContent(code)) return <span />;

  // const linesCount = code.match(/\n/g)?.length || 1;
  // const shortView = `code... ${linesCount} lines`;
  // return (
  //   <div className="simple-code" onClick={() => setExpand(!expand)}>
  //     {expand ? (
  //       <CodeMirror
  //         value={code}
  //         options={{
  //           mode: 'javascript',
  //           theme: 'material',
  //           lineNumbers: true,
  //         }}
  //         // onChange={(editor, data, value) => {
  //         // }}
  //       />
  //     ) : (
  //       shortView
  //     )}
  //   </div>
  // );
};

const FileView: React.FC<{
  fileDetails: FileMapDetailed;
  filename: string;
  ref?: React.Ref<any>;
}> = ({ fileDetails, filename, ref }) => {
  const { content, mapping } = fileDetails;
  const { functionDeclarations, functionCalls } = dropIrrelevantFunctionCalls(
    mapping
  );

  const fileStruct = buildNodesTree(
    functionDeclarations,
    functionCalls,
    content.length
  );
  const fileContent = renderChildren(content, fileStruct.children);

  console.log({ functionDeclarations, functionCalls });
  return (
    <div className="file-view" ref={ref}>
      <div className="file-view-heading">
        <FilenamePrettyView filename={filename} />
      </div>
      <CodeMirrorProvider content={content}>{fileContent}</CodeMirrorProvider>
    </div>
  );
};

const HiddenRelatedFile: React.FC<{ filename: string }> = ({ filename }) => {
  return <div className="hidden-file">{filename} hidden</div>;
};

export const generateConnections = (
  mainFilename: string,
  mainFileMapping: FileMapping,
  referencesMappings: Record<string, FileMapDetailed | null>
) => {
  const includedItems = new Set(
    mainFileMapping.includes.flatMap((incl) => incl.items)
  );
  const declaredItems = new Set(
    mainFileMapping.functionDeclarations.flatMap((decl) => decl.name)
  );

  const mainFileCalls = mainFileMapping.functionCalls
    .filter(
      (fc) => includedItems.has(fc.name)
      //  || declaredItems.has(fc.name)
    )
    .map((fc) => {
      const { name } = fc;

      const sourceHandle = funcCallSlug(fc);
      const fdFilename = mainFileMapping.includes.find((incl) =>
        incl.items.includes(name)
      )!.from;
      //includedItems.has(name)      ?
      // : mainFilename;

      const targetHandle = funcDeclSlugFromPieces(fdFilename, name);

      return {
        id: `${sourceHandle}-${targetHandle}`,
        source: mainFilename,
        target: fdFilename,
        sourceHandle,
        targetHandle,
      };
    });

  const referencesCallsFromMain = Object.entries(referencesMappings).flatMap(
    ([flnm, fnMapping]) => {
      if (!fnMapping) return [];

      const itemsIncludedFromMainFile = new Set(
        fnMapping.mapping.includes
          .filter((incl) => incl.from === mainFilename)
          .flatMap((incl) => incl.items)
      );
      //

      return fnMapping.mapping.functionCalls
        .filter(
          (fc) =>
            itemsIncludedFromMainFile.has(fc.name) && declaredItems.has(fc.name)
        )
        .map((fc) => {
          const { name } = fc;
          const sourceHandle = funcCallSlug(fc);
          const targetHandle = funcDeclSlugFromPieces(mainFilename, name);
          return {
            id: `${sourceHandle}-${targetHandle}`,
            source: fc.filename,
            target: mainFilename,
            sourceHandle,
            targetHandle,
          };
        });
    }
  );

  return mainFileCalls.concat(referencesCallsFromMain);
};

export const LogicMap: React.FC<{
  data: FileMapDetailed;
  filename: string;
  projectMap: FileIncludeInfo[];
  onRequestRelatedFile: (filename: string) => FileMapDetailed | null;
  onClose: () => void;
}> = ({ data, filename, projectMap, onRequestRelatedFile, onClose }) => {
  const ref_onRequestRelatedFile = useRef(onRequestRelatedFile);

  const elements = useMemo(() => {
    const includes = projectMap
      .filter((incl) => incl.to === filename)
      .map((incl) => incl.from);
    const references = projectMap
      .filter((incl) => incl.from === filename)
      .map((incl) => incl.to);

    const includesMappings = Object.fromEntries(
      includes.map((flnm) => [flnm, ref_onRequestRelatedFile.current(flnm)])
    );
    const referencesMappings = Object.fromEntries(
      references.map((flnm) => [flnm, ref_onRequestRelatedFile.current(flnm)])
    );

    const { mapping } = data;
    const connections = generateConnections(
      filename,
      mapping,
      referencesMappings
    );
    console.log('Connections', connections);

    const colWidth = window.innerWidth / 3;
    const mainWidth = colWidth * 0.85; //* 1.85;
    const supplWidth = colWidth * 0.85;
    const middleColOffet = colWidth;
    const rightColOffet = colWidth * 2;

    const elements = [
      ...connections,
      {
        id: filename,
        data: {
          label: <FileView fileDetails={data} filename={filename} />,
        },
        style: {
          // width: 500,
          width: mainWidth,
          // height: 1000,
        },
        position: {
          x: middleColOffet,
          y: 0,
        },
      },

      ...references.map((fn, idx) => {
        const id = fn;
        const fMapping = referencesMappings[fn];
        const el = fMapping ? (
          <FileView key={id} fileDetails={fMapping} filename={fn} />
        ) : (
          <HiddenRelatedFile key={id} filename={fn} />
        );
        return {
          id,
          data: {
            label: el,
          },
          style: {
            width: supplWidth,
          },
          position: {
            x: 10 + idx * 10,
            y: idx * 300,
          },
        };
      }),

      ...includes.map((fn, idx) => {
        const id = fn;
        const fMapping = includesMappings[fn];
        const el = fMapping ? (
          <FileView key={id} fileDetails={fMapping} filename={fn} />
        ) : (
          <HiddenRelatedFile key={id} filename={fn} />
        );
        return {
          id,
          data: {
            label: el,
          },
          style: {
            width: supplWidth,
          },
          position: {
            x: rightColOffet + idx * 10,
            y: idx * 300,
          },
        };
      }),
    ];
    return elements;
  }, [data, filename, projectMap]);

  console.log('Elements', elements);
  return (
    <div className="logic-map-main">
      <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 5 }}>
        <button onClick={() => onClose()}>X</button>
      </div>
      <ReactFlow
        elements={elements}
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
