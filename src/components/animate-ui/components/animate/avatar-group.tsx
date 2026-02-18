"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type AvatarGroupTooltipProps = {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

type AvatarGroupProps = {
    children: React.ReactNode;
    className?: string;
};

const AVATAR_TOOLTIP_TYPE = Symbol("AvatarGroupTooltip");

type TooltipMarkerComponent = React.FC<AvatarGroupTooltipProps> & {
    __avatarGroupTooltipType: symbol;
};

/**
 * Marker component — rendered content is extracted by AvatarGroup.
 * `open` and `onOpenChange` are forwarded to the Radix Tooltip by
 * the parent AvatarGroup; they are intentionally not consumed here.
 */
export const AvatarGroupTooltip: TooltipMarkerComponent = ({ children }: AvatarGroupTooltipProps) => {
    return <>{children}</>;
};
AvatarGroupTooltip.__avatarGroupTooltipType = AVATAR_TOOLTIP_TYPE;
AvatarGroupTooltip.displayName = "AvatarGroupTooltip";

const isTooltipNode = (node: React.ReactNode): node is React.ReactElement<AvatarGroupTooltipProps> => {
    return (
        React.isValidElement(node) &&
        typeof node.type !== "string" &&
        (node.type as any).__avatarGroupTooltipType === AVATAR_TOOLTIP_TYPE
    );
};

export function AvatarGroup({ children, className }: AvatarGroupProps) {
    const items = React.Children.toArray(children).filter(React.isValidElement);

    return (
        <TooltipProvider delayDuration={100} skipDelayDuration={300}>
            <div className={cn("flex items-center overflow-visible -space-x-3 isolate [contain:layout]", className)}>
                {items.map((child, index) => {
                    const avatarNode = child as React.ReactElement<any>;
                    const avatarChildren = React.Children.toArray(avatarNode.props.children);
                    const tooltipNode = avatarChildren.find(isTooltipNode);
                    const filteredChildren = avatarChildren.filter((node) => !isTooltipNode(node));

                    const avatar = React.cloneElement(avatarNode, {
                        children: filteredChildren,
                        className: cn(avatarNode.props.className),
                    });

                    if (!tooltipNode) {
                        return <React.Fragment key={avatarNode.key ?? index}>{avatar}</React.Fragment>;
                    }

                    return (
                        <Tooltip
                            key={avatarNode.key ?? index}
                            open={tooltipNode.props.open}
                            onOpenChange={tooltipNode.props.onOpenChange}
                        >
                            <TooltipTrigger asChild>{avatar}</TooltipTrigger>
                            <TooltipContent
                                side="top"
                                align="center"
                                sideOffset={10}
                                avoidCollisions={false}
                                className="!animate-none bg-black text-white border-0 rounded-lg px-3 py-2 text-xs text-center motion-reduce:transition-none opacity-0 data-[state=delayed-open]:opacity-100 data-[state=instant-open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-75"
                            >
                                {tooltipNode.props.children}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </TooltipProvider>
    );
}
