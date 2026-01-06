import * as React from "react"

import { cn } from "../lib/utils"

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
    value?: number
}

const clamp = (n: number) => {
    if (!Number.isFinite(n)) return 0
    return Math.min(100, Math.max(0, n))
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
    ({ className, value, ...props }, ref) => {
        const v = clamp(Number(value ?? 0))
        return (
            <div
                ref={ref}
                className={cn(
                    "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
                    className
                )}
                {...props}
            >
                <div
                    className="h-full w-full flex-1 bg-primary transition-all"
                    style={{ transform: `translateX(-${100 - v}%)` }}
                />
            </div>
        )
    }
)
Progress.displayName = "Progress"

export { Progress }
