"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
    ({ className, ...props }, ref) => {
        return (
            <label
                className={cn(
                    "text-sm font-medium text-zinc-900 dark:text-zinc-100",
                    "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);

Label.displayName = "Label";

export { Label };
export default Label;
