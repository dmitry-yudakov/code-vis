import js from './js';

export const getAnalyzer = (ext: string) => {
  switch (ext) {
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      return js;
    default:
      console.log('Cannot find analyzer for given type:', ext);
      throw new Error('Cannot find analyzer for given type');
  }
};
