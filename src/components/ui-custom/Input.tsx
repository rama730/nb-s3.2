"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60",
                    "placeholder:text-zinc-400",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);

Input.displayName = "Input";

export default Input;
