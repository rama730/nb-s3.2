import { useCallback } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { PaneId } from "../../state/filesTabTypes";
import type { TabDnDActions } from "./types";

interface UseTabDnDOptions extends TabDnDActions {
  projectId: string;
}

export function useTabDnD({ projectId, reorderTabs, moveTabToPane }: UseTabDnDOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const state = useFilesWorkspaceStore.getState().byProjectId[projectId];
      if (!state) return;

      const findPane = (id: string) => {
        if (id === "left" || id === "right") return id;
        if (state.panes.left.openTabIds.includes(id)) return "left";
        if (state.panes.right.openTabIds.includes(id)) return "right";
        return null;
      };

      const activeP = findPane(active.id as string);
      const overP = findPane(over.id as string);
      if (!activeP || !overP) return;

      if (activeP === overP) {
        const pane = state.panes[activeP];
        const oldIndex = pane.openTabIds.indexOf(active.id as string);
        const newIndex = pane.openTabIds.indexOf(over.id as string);
        if (oldIndex !== newIndex && newIndex !== -1) {
          reorderTabs(
            projectId,
            activeP as PaneId,
            arrayMove(pane.openTabIds, oldIndex, newIndex)
          );
        }
      } else {
        const overIndex = state.panes[overP].openTabIds.indexOf(over.id as string);
        moveTabToPane(
          projectId,
          activeP as PaneId,
          overP as PaneId,
          active.id as string,
          overIndex
        );
      }
    },
    [projectId, reorderTabs, moveTabToPane]
  );

  return {
    sensors,
    handleDragEnd,
  };
}
