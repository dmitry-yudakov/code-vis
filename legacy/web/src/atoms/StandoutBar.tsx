import React from 'react';

export const StandoutBar: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        width: '100%',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
};
