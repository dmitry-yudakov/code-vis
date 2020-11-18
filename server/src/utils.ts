import { IFileIncludeInfo } from './types';

export const autoAppendJSextensionInPlace = (
  info: IFileIncludeInfo,
  projectFiles: string[]
) => {
  const { from } = info;
  for (let filename of projectFiles) {
    if (
      filename.length > from.length &&
      filename.length - from.length <= 5 &&
      filename.indexOf(from) === 0 &&
      filename[from.length] === '.'
    ) {
      console.log('AutoComplete', from, 'to', filename);
      info.from = filename;
      break;
    }
  }
};

export const resolveRelativeIncludePathInPlace = (info: IFileIncludeInfo) => {
  const re = /\//;
  const { to, from } = info;
  const pathTokens = to.split(re).filter((t) => !!t);
  pathTokens.pop(); // remove filename and leave only path

  const fromTokens = from.split(re).filter((t) => !!t);

  for (const token of fromTokens) {
    if (token === '.') {
      // noop
    } else if (token === '..') {
      pathTokens.pop();
    } else {
      pathTokens.push(token);
    }
  }
  // info.from = '/' + pathTokens.join('/');
  info.from = pathTokens.join('/');
  // console.log(info.from, info.to);
};
