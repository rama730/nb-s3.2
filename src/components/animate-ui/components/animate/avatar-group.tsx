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
        <TooltipProvider delayDuration={80} skipDelayDuration={0}>
            <div className={cn("flex items-center -space-x-3", className)}>
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
                                sideOffset={8}
                                collisionPadding={12}
                                className="text-xs text-center motion-reduce:transition-none"
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
