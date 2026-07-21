import { useMemo } from "react";
import { rankFocusTasks } from "@/lib/projects/task-focus";
import type { TaskSurfaceRecord } from "@/lib/projects/task-presentation";

interface UseTaskFiltersProps {
    tasks: TaskSurfaceRecord[];
    currentUserId?: string;
}

export function useTaskFilters({ tasks, currentUserId }: UseTaskFiltersProps) {

    const myFocusTasks = useMemo(() => {
        if (!currentUserId) return [];
        return rankFocusTasks(
            tasks.filter(t =>
                t.assigneeId === currentUserId &&
                t.status !== 'done'
            ),
        );
    }, [tasks, currentUserId]);

    const needsOwnerTasks = useMemo(() => {
        return rankFocusTasks(
            tasks.filter(t =>
                !t.assigneeId &&
                t.status !== 'done'
            ),
        );
    }, [tasks]);

    return {
        filteredTasks: tasks,
        myFocusTasks,
        needsOwnerTasks
    };
}
