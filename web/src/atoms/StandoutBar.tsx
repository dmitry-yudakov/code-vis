import React from 'react';

export const StandoutBar: React.FC = ({ children }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '105%',
        width: '100%',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
};
