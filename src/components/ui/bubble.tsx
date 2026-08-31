import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const bubbleVariants = cva(
  "relative flex flex-col gap-1 shadow-sm transition-shadow duration-200",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        muted:
          "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-200/40 dark:border-zinc-700/40",
        tinted:
          "bg-indigo-50 text-indigo-900 border border-indigo-200/50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800/30",
        outline:
          "bg-background text-foreground border border-border hover:bg-muted",
        ghost:
          "bg-transparent text-foreground shadow-none hover:bg-muted/50 p-0",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20",
      },
      align: {
        start: "rounded-2xl rounded-bl-sm",
        end: "rounded-2xl rounded-br-sm",
      }
    },
    defaultVariants: {
      variant: "default",
      align: "start",
    },
  }
)

export interface BubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleVariants> {
  asChild?: boolean
}

const Bubble = React.forwardRef<HTMLDivElement, BubbleProps>(
  ({ className, variant, align, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        data-bubble-align={align}
        className={cn(bubbleVariants({ variant, align, className }), variant !== "ghost" && "px-4 py-2.5")}
        {...props}
      />
    )
  }
)
Bubble.displayName = "Bubble"

const bubbleContentVariants = cva(
  "min-w-0 max-w-full break-words outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring rounded-lg transition-colors",
  {
    variants: {
      variant: {
        default: "",
        ghost: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BubbleContentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleContentVariants> {
  render?: React.ReactElement
  asChild?: boolean
}

const BubbleContent = React.forwardRef<HTMLDivElement, BubbleContentProps>(
  ({ className, variant, render, asChild = false, children, ...props }, ref) => {
    if (render) {
      // eslint-disable-next-line react-hooks/refs
      const Comp = React.cloneElement(render, {
        className: cn(bubbleContentVariants({ variant, className }), (render.props as any).className),
        ...props,
        ref,
      } as any)
      return <>{React.cloneElement(Comp, {}, children)}</>
    }

    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn(bubbleContentVariants({ variant, className }))}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
BubbleContent.displayName = "BubbleContent"

const bubbleReactionsVariants = cva(
  "absolute z-10 flex items-center gap-0.5 rounded-full border border-zinc-200/80 bg-background/95 p-1 shadow-md backdrop-blur-sm select-none dark:border-zinc-700/80 dark:bg-zinc-900/95",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-1/2",
        bottom: "bottom-0 translate-y-1/2",
      },
      align: {
        start: "-left-1",
        end: "-right-1",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
)

export interface BubbleReactionsProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleReactionsVariants> {}

const BubbleReactions = React.forwardRef<HTMLDivElement, BubbleReactionsProps>(
  ({ className, side, align, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(bubbleReactionsVariants({ side, align, className }))}
        {...props}
      />
    )
  }
)
BubbleReactions.displayName = "BubbleReactions"

const BubbleGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-0.5",
          // The group flattens corners on consecutive messages
          "[&>[data-bubble-align=start]:not(:first-child)]:rounded-tl-sm",
          "[&>[data-bubble-align=end]:not(:first-child)]:rounded-tr-sm",
          "[&>[data-bubble-align=start]:not(:last-child)]:rounded-bl-sm",
          "[&>[data-bubble-align=end]:not(:last-child)]:rounded-br-sm",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
BubbleGroup.displayName = "BubbleGroup"

export { Bubble, BubbleContent, BubbleReactions, BubbleGroup, bubbleVariants }
