import WorkspaceRouteClient from "@/components/workspace/WorkspaceRouteClient";

export async function generateMetadata() {
    return {
        title: "Workspace | Edge",
        description: "A stable workspace shell for tasks, notes, inbox, and activity.",
    };
}

export default function WorkspacePage() {
    return (
        <div
            data-scroll-root="route"
            data-testid="workspace-route-scroll"
            className="h-full min-h-0 overflow-auto"
        >
            <WorkspaceRouteClient />
        </div>
    );
}
