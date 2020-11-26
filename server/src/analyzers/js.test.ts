import jsAnalyzer from './js';
const { DEBUG } = process.env;

describe('Includes using "import"', () => {
  test('from same directory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(['src/dir/a.js'], async (filename) => {
        expect(filename).toBe('src/dir/a.js');
        return `import gaga from './b.js'`;
      })
    ).resolves.toEqual([
      { from: 'src/dir/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('from different subdirectory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `import gaga from '../dir2/b.js'`
      )
    ).resolves.toEqual([
      { from: 'src/dir2/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('from different directory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `import gaga from '../../src2/dir2/b.js'`
      )
    ).resolves.toEqual([
      { from: 'src2/dir2/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('non-default exports', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `import { gaga, maga } from './b.js'`
      )
    ).resolves.toEqual([
      { from: 'src/dir/b.js', to: 'src/dir/a.js', items: ['gaga', 'maga'] },
    ]));

  test('mixed exports', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `import { gaga, maga }, yaga from './b.js'`
      )
    ).resolves.toEqual([
      {
        from: 'src/dir/b.js',
        to: 'src/dir/a.js',
        items: ['gaga', 'maga', 'yaga'],
      },
    ]));

  test('multiple imports', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `
      import { gaga, maga } from './b.js';
      import djaga from './c.js';
      `
      )
    ).resolves.toEqual([
      {
        from: 'src/dir/b.js',
        to: 'src/dir/a.js',
        items: ['gaga', 'maga'],
      },
      {
        from: 'src/dir/c.js',
        to: 'src/dir/a.js',
        items: ['djaga'],
      },
    ]));

  // test('multiple lines', () =>
  //   expect(
  //     jsAnalyzer.extractFilesHierarchy(
  //       ['src/dir/a.js'],
  //       async () => `
  //     import {
  //       gaga,
  //       maga
  //     } from './b.js';
  //     `
  //     )
  //   ).resolves.toEqual([
  //     {
  //       from: 'src/dir/b.js',
  //       to: 'src/dir/a.js',
  //       items: ['gaga', 'maga'],
  //     },
  //   ]));
});

describe('Includes using "require"', () => {
  test('from same directory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(['src/dir/a.js'], async (filename) => {
        expect(filename).toBe('src/dir/a.js');
        return `const gaga = require('./b.js')`;
      })
    ).resolves.toEqual([
      { from: 'src/dir/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('from different subdirectory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `const gaga = require('../dir2/b.js')`
      )
    ).resolves.toEqual([
      { from: 'src/dir2/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('from different directory', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `const gaga = require('../../src2/dir2/b.js')`
      )
    ).resolves.toEqual([
      { from: 'src2/dir2/b.js', to: 'src/dir/a.js', items: ['gaga'] },
    ]));

  test('non-default exports', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `const { gaga, maga } = require('./b.js')`
      )
    ).resolves.toEqual([
      { from: 'src/dir/b.js', to: 'src/dir/a.js', items: ['gaga', 'maga'] },
    ]));

  test('multiple requires', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `
      const { gaga, maga } = require('./b.js');
      const djaga = require('./c.js');
      `
      )
    ).resolves.toEqual([
      {
        from: 'src/dir/b.js',
        to: 'src/dir/a.js',
        items: ['gaga', 'maga'],
      },
      {
        from: 'src/dir/c.js',
        to: 'src/dir/a.js',
        items: ['djaga'],
      },
    ]));

  test('var/let/const', () =>
    expect(
      jsAnalyzer.extractFilesHierarchy(
        ['src/dir/a.js'],
        async () => `
        const gaga = require('./b.js');
        let djaga = require('./c.js');
        var yaga = require('./d.js');
        `
      )
    ).resolves.toEqual([
      {
        from: 'src/dir/b.js',
        to: 'src/dir/a.js',
        items: ['gaga'],
      },
      {
        from: 'src/dir/c.js',
        to: 'src/dir/a.js',
        items: ['djaga'],
      },
      {
        from: 'src/dir/d.js',
        to: 'src/dir/a.js',
        items: ['yaga'],
      },
    ]));

  // test('multiple lines', () =>
  //   expect(
  //     jsAnalyzer.extractFilesHierarchy(
  //       ['src/dir/a.js'],
  //       async () => `
  //     const {
  //       gaga,
  //       maga
  //     } = require('./b.js');
  //     `
  //     )
  //   ).resolves.toEqual([
  //     {
  //       from: 'src/dir/b.js',
  //       to: 'src/dir/a.js',
  //       items: ['gaga', 'maga'],
  //     },
  //   ]));
});

describe('File mapping', () => {
  test('regular functions', () => {
    const content = `
const somevar = 42;

function gaga(a) {
  return a + a;
}

gaga(42);
const c = 3 + gaga(12) + FEFE(gaga(33));
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();
    const funcBody = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody}|`);
    expect(funcBody).toContain('function gaga(a) {\n  return a + a;\n}');
  });

  test('arrow functions', () => {
    const content = `
const somevar = 42;

const maga = (a: string, b: string) => a + b;
const yaga = (a: number, b: any) => {
  const c = a + b;
  return c * 2;
}
maga(1,2);
yaga(1,2);
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain(
      'const maga = (a: string, b: string) => a + b;'
    );
    expect(funcBody1).not.toContain('yaga');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain(
      'const yaga = (a: number, b: any) => {\n  const c = a + b;\n  return c * 2;\n}'
    );
    expect(funcBody2).not.toContain('maga');
  });

  test('arrow functions with more complex statements', () => {
    const content = `
const maga = (a: string, b: string) => a + b,
  yaga = (a: number, b: any) => {
    let c = a + b;
    return c * 2;
  };
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('maga = (a: string, b: string) => a + b');
    expect(funcBody1).not.toContain('yaga');
    expect(funcBody1).not.toContain('const');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain(
      'yaga = (a: number, b: any) => {\n    let c = a + b;\n    return c * 2;\n  }'
    );
    expect(funcBody2).not.toContain('maga');
    expect(funcBody2).not.toContain('const');
  });

  test('class functions', () => {
    const content = `
class CL {
  constructor() {
    super();
  };
  
  propFunc = (a) => a;

  methodFunc(a) {
    return a;
  }
}
const cl = new CL();
cl.propFunc(42);
cl.methodFunc(12);
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('propFunc = (a) => a;');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain('methodFunc(a) {\n    return a;\n  }');
  });

  test('async/await functions', () => {
    const content = `
function gaga(a) {
  return 42;
}
async function agaga(a) {
  return 42;
}
const amaga = async (a) => 42;
const maga = (a) => 42;
await agaga(11);
await amaga(22);
gaga(111);
maga(1221);
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('function gaga(a) {\n  return 42;\n}');

    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain('async function agaga(a) {\n  return 42;\n}');

    const funcBody3 = content.slice(
      res.functionDeclarations[2].pos,
      res.functionDeclarations[2].end
    );
    DEBUG && console.log(`|${funcBody3}|`);
    expect(funcBody3).toContain('const amaga = async (a) => 42;');

    const funcBody4 = content.slice(
      res.functionDeclarations[3].pos,
      res.functionDeclarations[3].end
    );
    DEBUG && console.log(`|${funcBody4}|`);
    expect(funcBody4).toContain('const maga = (a) => 42;');
  });

  test('async/await functions in class', () => {
    const content = `
class CL {]
  propFunc = (a) => a;
  async methodFuncAsync(a) {
    return a;
  }
  propFuncAsync = async (a) => a;
  methodFunc(a) {
    return a;
  }
}
const cl = new CL();
await cl.propFuncAsync(42);
await cl.methodFuncAsync(12);
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.js', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('propFunc = (a) => a;');

    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain(
      'async methodFuncAsync(a) {\n    return a;\n  }'
    );

    const funcBody3 = content.slice(
      res.functionDeclarations[2].pos,
      res.functionDeclarations[2].end
    );
    DEBUG && console.log(`|${funcBody3}|`);
    expect(funcBody3).toContain('propFuncAsync = async (a) => a;');

    const funcBody4 = content.slice(
      res.functionDeclarations[3].pos,
      res.functionDeclarations[3].end
    );
    DEBUG && console.log(`|${funcBody4}|`);
    expect(funcBody4).toContain('methodFunc(a) {\n    return a;\n  }');
  });

  test('jsx', () => {
    const content = `import React from 'react';

export const History = ({ history }: { history: any[][] }) => {
  const onClick = () => {
    alert('CLICK');
  }
  return (
    <div className="history-bar">
      {history.map(([tm, s], idx) => (
        <div key={s + idx}>
          {tm.toLocaleTimeString()}: {s}
          <button onClick={onClick}>Button</button>
        </div>
      ))}
    </div>
  );
};
    `;
    const res = jsAnalyzer.extractFileMapping('src/dir/a.tsx', content);
    DEBUG && console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    DEBUG && console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('export const History = ({ history }:');
    expect(funcBody1).toContain('<div');
    expect(funcBody1).toContain('</div>');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    DEBUG && console.log(`|${funcBody2}|`);
    expect(funcBody2).toEqual(
      "const onClick = () => {\n    alert('CLICK');\n  }"
    );
  });
});
