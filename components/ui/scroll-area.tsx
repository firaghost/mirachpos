import * as React from 'react';
import { cn } from '../lib/utils';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn('overflow-auto min-h-0 pointer-events-auto relative z-0', className)} {...props} />;
});
ScrollArea.displayName = 'ScrollArea';
