import * as React from "react";

import { cn } from "@/lib/utils";

type AppScrollAxis = "y" | "x" | "both";
type AppScrollVariant = "hover" | "always" | "hidden";

export interface AppScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  axis?: AppScrollAxis;
  variant?: AppScrollVariant;
  stableGutter?: boolean;
  dataScrollRoot?: boolean;
}

const axisClasses: Record<AppScrollAxis, string> = {
  y: "app-scroll-y",
  x: "app-scroll-x",
  both: "app-scroll-both",
};

const variantClasses: Record<AppScrollVariant, string> = {
  hover: "",
  always: "app-scroll-always",
  hidden: "app-scroll-hidden",
};

export const AppScrollArea = React.forwardRef<HTMLDivElement, AppScrollAreaProps>(
  (
    {
      axis = "y",
      variant = "hover",
      stableGutter = axis !== "x",
      dataScrollRoot = false,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-scroll-root={dataScrollRoot ? "route" : undefined}
        className={cn(
          "app-scroll",
          axisClasses[axis],
          variantClasses[variant],
          stableGutter ? "app-scroll-gutter" : "",
          className,
        )}
        {...props}
      />
    );
  },
);

AppScrollArea.displayName = "AppScrollArea";
