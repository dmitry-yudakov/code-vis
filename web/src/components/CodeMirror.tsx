import React, { useContext, useEffect, useRef, useState } from 'react';
import { FunctionCallInfo, FunctionDeclarationInfo } from '../types';
import { UnControlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/material.css';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/javascript/javascript';
import './CodeMirror.css';

const CodeMirrorContext = React.createContext<any>(null);
export const CodeMirrorProvider: React.FC<{ content: string }> = ({
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

export const useFuncCall = (func: FunctionCallInfo) => {
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
    // cm.addWidget(cm.posFromIndex(end), el);
  }, [cm, el, pos, end]);

  return ref;
};

export const useFuncDecl = (func: FunctionDeclarationInfo) => {
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
    // cm.addWidget(cm.posFromIndex(pos), el);
  }, [cm, el, pos, end]);
  return ref;
};
