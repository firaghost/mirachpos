import React from 'react';

type Props = {
  title: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
};

export const OwnerPageHeader: React.FC<Props> = ({ title, leftSlot, rightSlot }) => {
  return (
    <header className="h-16 shrink-0 border-b border-[#393328] flex items-center justify-between px-6 lg:px-10 bg-[#181611] text-white">
      <div className="flex items-center gap-4 min-w-0">
        <h2 className="text-xl font-bold leading-tight tracking-tight truncate">{title}</h2>
        {leftSlot ? <div className="min-w-0">{leftSlot}</div> : null}
      </div>
      <div className="flex items-center gap-4 min-w-0">{rightSlot}</div>
    </header>
  );
};
