import { FileMapping, FunctionCallInfo } from '../types';
import jsAnalyzer from './js';

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
    // console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();
    const funcBody = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    // console.log(`|${funcBody}|`);
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
    // console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    // console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain(
      'const maga = (a: string, b: string) => a + b;'
    );
    expect(funcBody1).not.toContain('yaga');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    // console.log(`|${funcBody2}|`);
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
    // console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    // console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('maga = (a: string, b: string) => a + b');
    expect(funcBody1).not.toContain('yaga');
    expect(funcBody1).not.toContain('const');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    // console.log(`|${funcBody2}|`);
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
    // console.log(content, JSON.stringify(res, null, 2));
    expect(res).toMatchSnapshot();

    const funcBody1 = content.slice(
      res.functionDeclarations[0].pos,
      res.functionDeclarations[0].end
    );
    // console.log(`|${funcBody1}|`);
    expect(funcBody1).toContain('propFunc = (a) => a;');
    const funcBody2 = content.slice(
      res.functionDeclarations[1].pos,
      res.functionDeclarations[1].end
    );
    // console.log(`|${funcBody2}|`);
    expect(funcBody2).toContain('methodFunc(a) {\n    return a;\n  }');
  });
});
