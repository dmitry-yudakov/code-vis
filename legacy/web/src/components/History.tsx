import React from 'react';

export const History = ({ history }: { history: any[][] }) => {
  return (
    <div className="history-bar">
      {history.map(([tm, s], idx) => (
        <div key={s + idx}>
          {tm.toLocaleTimeString()}: {s}
        </div>
      ))}
    </div>
  );
};
