import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
    return {
        title: "Workspace | NetworkBase",
        description: "A stable workspace shell for tasks, notes, inbox, and activity.",
    };
}

export default function WorkspacePage() {
    // ponytail: /workspace was a second page only to open the hub drawer.
    // Keep old links working while the hub remains the single workspace host.
    redirect("/hub?workspace=tasks");
}
