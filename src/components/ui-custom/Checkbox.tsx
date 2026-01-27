"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({ className, checked, onCheckedChange, disabled, id, ...props }, ref) => {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            onCheckedChange?.(e.target.checked);
        };

        return (
            <div className="relative inline-flex items-center">
                <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={handleChange}
                    disabled={disabled}
                    className="sr-only peer"
                    ref={ref}
                    {...props}
                />
                <label
                    htmlFor={id}
                    className={cn(
                        "h-5 w-5 rounded-md border-2 cursor-pointer transition-all flex items-center justify-center",
                        checked
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700",
                        "hover:border-blue-500",
                        "peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/50 peer-focus-visible:ring-offset-2",
                        disabled && "opacity-50 cursor-not-allowed",
                        className
                    )}
                >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                </label>
            </div>
        );
    }
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
export default Checkbox;
