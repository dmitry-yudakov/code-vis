// import React from 'react';
// import { render } from '@testing-library/react';
// import App from './App';
import { getFilenameParts, isEmptyContent } from './utils';

describe('Utils', () => {
  test('detect empty space', () => {
    expect(isEmptyContent('  ')).toBe(true);

    expect(isEmptyContent('\t')).toBe(true);

    expect(
      isEmptyContent(`
    
    `)
    ).toBe(true);

    expect(
      isEmptyContent(`function gaga() {

        }

    `)
    ).toBe(false);

    expect(
      isEmptyContent(`
    
        function gaga() {

        }

    `)
    ).toBe(false);
  });

  test('parse filename parts', () => {
    expect(getFilenameParts('/src/client/App.tsx')).toEqual({
      path: '/src/client/',
      name: 'App',
      ext: 'tsx',
    });
    expect(getFilenameParts('index.tsx')).toEqual({
      path: '',
      name: 'index',
      ext: 'tsx',
    });
    expect(getFilenameParts('/src/client/Gaga')).toEqual({
      path: '',
      name: '/src/client/Gaga',
      ext: '',
    });
    expect(getFilenameParts('GagaDjaga')).toEqual({
      path: '',
      name: 'GagaDjaga',
      ext: '',
    });
  });
});

// test('renders learn react link', () => {
//   const { getByText } = render(<App />);
//   const linkElement = getByText(/learn react/i);
//   expect(linkElement).toBeInTheDocument();
// });
