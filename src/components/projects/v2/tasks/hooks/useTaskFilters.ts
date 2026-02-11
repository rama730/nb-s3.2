import { useMemo } from "react";
import { Task } from "../TaskCard";

interface UseTaskFiltersProps {
    tasks: Task[];
    currentUserId?: string;
    scope: 'all' | 'backlog' | 'sprint';
}

export function useTaskFilters({ tasks, currentUserId, scope }: UseTaskFiltersProps) {

    const filteredTasks = useMemo(() => {
        // Basic scope filtering can be expanded here.
        if (scope === 'backlog') {
            return tasks.filter((t) => !t.sprintId);
        }

        return tasks;
    }, [tasks, scope]);

    const myFocusTasks = useMemo(() => {
        if (!currentUserId) return [];
        return filteredTasks.filter(t =>
            t.assigneeId === currentUserId &&
            t.status !== 'done'
        );
    }, [filteredTasks, currentUserId]);

    const needsOwnerTasks = useMemo(() => {
        return filteredTasks.filter(t =>
            !t.assigneeId &&
            t.status !== 'done'
        );
    }, [filteredTasks]);

    return {
        filteredTasks,
        myFocusTasks,
        needsOwnerTasks
    };
}
