import React from 'react';
import { getFilenameParts } from '../utils';

export const FilenamePrettyView: React.FC<{ filename: string }> = ({
  filename,
}) => {
  const { path, name, ext } = getFilenameParts(filename);
  return (
    <div className="node">
      <div className="file-path">{path}</div>
      <div className="file-name">{name}</div>
      <div className="file-ext">.{ext}</div>
    </div>
  );
};
