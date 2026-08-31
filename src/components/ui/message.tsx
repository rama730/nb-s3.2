import React from 'react';
import { cn } from '@/lib/utils';

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
    align?: 'start' | 'end';
}

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
    ({ className, align = 'start', children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    'flex w-full gap-3 p-1',
                    align === 'end' ? 'flex-row-reverse' : 'flex-row',
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }
);
Message.displayName = 'Message';

export const MessageAvatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn('flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full', className)}
                {...props}
            >
                {children}
            </div>
        );
    }
);
MessageAvatar.displayName = 'MessageAvatar';

export const MessageContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn('flex flex-col gap-1 min-w-0 max-w-[85%] sm:max-w-[70%]', className)}
                {...props}
            >
                {children}
            </div>
        );
    }
);
MessageContent.displayName = 'MessageContent';

export const MessageHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn('flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 font-medium px-1', className)}
                {...props}
            >
                {children}
            </div>
        );
    }
);
MessageHeader.displayName = 'MessageHeader';

export const MessageFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn('flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium px-1 mt-0', className)}
                {...props}
            >
                {children}
            </div>
        );
    }
);
MessageFooter.displayName = 'MessageFooter';

export { Bubble, BubbleContent, BubbleReactions, BubbleGroup, bubbleVariants } from './bubble';

export const Marker = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    'flex w-full items-center justify-center my-4 text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide px-4',
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }
);
Marker.displayName = 'Marker';
