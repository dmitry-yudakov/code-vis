import React, { useContext, useEffect, useRef, useState } from 'react';

import MonacoEditor, { monaco } from '@monaco-editor/react';
import { FunctionCallInfo, FunctionDeclarationInfo } from '../types';

monaco
  .init()
  .then((monaco) => {
    /* here is the instance of monaco, so you can use the `monaco.languages` or whatever you want */
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  })
  .catch((error) =>
    console.error('An error occurred during initialization of Monaco: ', error)
  );

const monacoOptions = {
  minimap: {
    enabled: false,
  },
  // lineNumbers: true,
  wordWrap: 'on',
};

const MonacoEditorContext = React.createContext<any>(null);
export const MonacoEditorProvider: React.FC<{ content: string }> = ({
  content,
  children,
}) => {
  const [inst, setInst] = useState<any>(null);
  return (
    <>
      <MonacoEditor
        editorDidMount={(_, editor) => setInst(editor)}
        value={content}
        language="typescript"
        height={500}
        options={monacoOptions}
        // onChange={(editor, data, value) => {
        // }}
      />
      <MonacoEditorContext.Provider value={inst}>
        {children}
      </MonacoEditorContext.Provider>
    </>
  );
};

export const useFuncCall = (func: FunctionCallInfo) => {
  const ref = useRef<any>();
  const cm = useContext(MonacoEditorContext);

  const el = ref.current;
  const { pos, end } = func;
  useEffect(() => {
    // console.log('FunctionCallView', { pos, end, cm, el });

    if (!cm || !el) return;

    // underline
    // cm.markText(cm.posFromIndex(pos), cm.posFromIndex(end), {
    //   className: 'func-call-2',
    // });

    // // handle
    // cm.addWidget(cm.posFromIndex(end), el);
  }, [cm, el, pos, end]);
  return ref;
};

export const useFuncDecl = (func: FunctionDeclarationInfo) => {
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
