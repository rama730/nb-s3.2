'use client';

import type { ReactNode } from 'react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    type DragEndEvent,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SortableLinkListProps<T extends { id: string }> = {
    items: readonly T[];
    onReorder: (items: T[]) => void;
    children: (item: T) => ReactNode;
    getItemLabel: (item: T) => string;
    className?: string;
    itemClassName?: string;
    handleClassName?: string;
    layout?: 'grid' | 'vertical';
    disabled?: boolean;
};

function SortableLinkListItem<T extends { id: string }>({
    item,
    children,
    getItemLabel,
    itemClassName,
    handleClassName,
    disabled,
}: Pick<SortableLinkListProps<T>, 'children' | 'getItemLabel' | 'itemClassName' | 'handleClassName' | 'disabled'> & { item: T }) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id, disabled });

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
            className={cn(itemClassName, 'will-change-transform', isDragging && 'relative z-10 opacity-50 shadow-lg')}
        >
            <Button
                ref={setActivatorNodeRef}
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                className={cn('h-8 w-8 shrink-0 cursor-grab touch-none text-zinc-400 hover:text-zinc-700 active:cursor-grabbing dark:hover:text-zinc-200', handleClassName)}
                aria-label={`Reorder ${getItemLabel(item)}`}
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
            {children(item)}
        </div>
    );
}

/** Shared sortable behavior for profile and project link editors. */
export function SortableLinkList<T extends { id: string }>({
    items,
    onReorder,
    children,
    getItemLabel,
    className,
    itemClassName,
    handleClassName,
    layout = 'vertical',
    disabled = false,
}: SortableLinkListProps<T>) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const reorder = ({ active, over }: DragEndEvent) => {
        if (disabled || !over || active.id === over.id) return;
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorder(arrayMove([...items], oldIndex, newIndex));
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={reorder}
            accessibility={{
                screenReaderInstructions: {
                    draggable: 'To reorder a link, press Space, use the arrow keys, then press Space again.',
                },
            }}
        >
            <SortableContext
                items={items.map((item) => item.id)}
                strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
            >
                <div className={className}>
                    {items.map((item) => (
                        <SortableLinkListItem
                            key={item.id}
                            item={item}
                            getItemLabel={getItemLabel}
                            itemClassName={itemClassName}
                            handleClassName={handleClassName}
                            disabled={disabled}
                        >
                            {children}
                        </SortableLinkListItem>
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    );
}
