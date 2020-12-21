import React, { useContext, useEffect, useRef, useState } from 'react';
import MonacoEditor, { monaco as __monaco } from '@monaco-editor/react';
import { FunctionCallInfo, FunctionDeclarationInfo } from '../types';
import { useDebouncedCallback } from 'use-debounce';

let monaco: any;

__monaco
  .init()
  .then((monacoInst) => {
    monaco = monacoInst;

    /* here is the instance of monaco, so you can use the `monaco.languages` or whatever you want */
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    });
  })
  .catch((error) =>
    console.error('An error occurred during initialization of Monaco: ', error)
  );

const monacoOptions = {
  wordWrap: 'on',
  minimap: {
    enabled: false,
  },

  scrollBeyondLastLine: false,
  wrappingStrategy: 'advanced',
  overviewRulerLanes: 0,

  lineNumbers: 'off',
};

const MonacoEditorContext = React.createContext<any>(null);
export const MonacoEditorProvider: React.FC<{
  content: string;
  onScroll?: () => void;
}> = ({ content, children, onScroll }) => {
  const [editor, setEditor] = useState<any>(null);

  const ref = useRef<HTMLDivElement | null>(null);
  const container = ref.current;

  const debOnScroll = useDebouncedCallback(onScroll || (() => {}), 200);
  const isOnScrollSet = !!onScroll;

  const updateHeight = useDebouncedCallback(() => {
    // console.log('try to update height');
    if (!editor || !container) return;
    const width = 500;
    // let ignoreEvent = false;
    // if (ignoreEvent) return;

    const contentHeight = Math.min(1000, editor.getContentHeight());
    container.style.width = `${width}px`;
    container.style.height = `${contentHeight}px`;
    try {
      // ignoreEvent = true;
      const newLayout = { width, height: contentHeight };
      // console.log('Apply layout', newLayout, 'to editor', editor);
      editor.layout(newLayout);
    } finally {
      // ignoreEvent = false;
    }
  }, 100);

  useEffect(() => {
    if (!editor || !container) return;

    editor.onDidContentSizeChange(updateHeight.callback);
    updateHeight.callback();
    if (isOnScrollSet) editor.onDidScrollChange(debOnScroll.callback);
  }, [editor, container, isOnScrollSet, debOnScroll, updateHeight]);

  return (
    <div ref={ref}>
      <MonacoEditor
        editorDidMount={(_, editor) => setEditor(editor)}
        value={content}
        language="typescript"
        // height={500}
        options={monacoOptions}
        // onChange={(editor, data, value) => {
        // }}
      />
      <MonacoEditorContext.Provider value={editor}>
        {children}
      </MonacoEditorContext.Provider>
    </div>
  );
};

export const useFuncCall = (
  func: FunctionCallInfo,
  parent: FunctionDeclarationInfo | null
) => {
  const ref = useRef<any>();
  const editor = useContext(MonacoEditorContext);

  // const el = ref.current;
  const offset = parent ? parent.pos : 0;
  // const callUniqueClass = funcCallSlug(func).replace(/[^a-zA-Z0-9-]/g, '_');

  useEffect(() => {
    const { pos, end } = func;

    if (!editor) return;

    editor.deltaDecorations(
      [],
      [
        {
          range: _range(pos - offset, end - offset, editor),
          // options: { inlineClassName: `func-call ${callUniqueClass}` },
          options: {
            className: 'func-call',
            // afterContentClassName: callUniqueClass,
            // isWholeLine: true,
            // linesDecorationsClassName: `func-call-line ${callUniqueClass}`,
          },
        },
      ]
    );
  }, [editor, func, offset]);
  return ref;
};

export const useFuncDecl = (func: FunctionDeclarationInfo) => {
  const ref = useRef<any>();
  // noop
  return ref;
};

export const useInnerFuncDecl = (func: FunctionDeclarationInfo) => {
  const ref = useRef<any>();
  const cm = useContext(MonacoEditorContext);

  const el = ref.current;
  const { pos, end } = func;
  useEffect(() => {
    // console.log('FunctionDeclarationView', { pos, end, cm, el });

    if (!cm || !el) return;

    // underline
    // cm.markText(cm.posFromIndex(pos), cm.posFromIndex(end), {
    //   // className: 'func-decl-2',
    //   startStyle: 'func-decl-2',
    // });

    // // handle
    // cm.addWidget(cm.posFromIndex(pos), el);
  }, [cm, el, pos, end]);
  return ref;
};

function _range(pos: number, end: number, editor: any) {
  return monaco.Range.fromPositions(
    editor.getModel().getPositionAt(pos),
    editor.getModel().getPositionAt(end)
  );
}
