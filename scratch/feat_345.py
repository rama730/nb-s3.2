import re

# =======================
# 1. ConnectionsClient.tsx (Feature 3)
# =======================
with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Add bulk actions
bulk_hooks = """    const { disconnect } = useConnectionMutations();
    const bulkActions = useBulkConnectionsActions();
    const [bulkDisconnectTarget, setBulkDisconnectTarget] = useState(false);
"""
content = content.replace("    const { disconnect } = useConnectionMutations();", bulk_hooks)

bulk_ui = """                            <button
                                type="button"
                                onClick={() => setBulkDisconnectTarget(true)}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 dark:bg-zinc-900/20 text-sm font-medium hover:bg-white/30 dark:hover:bg-zinc-900/30 transition-colors text-red-400 hover:text-red-300"
                            >
                                <X className="w-3.5 h-3.5" />
                                Disconnect
                            </button>
                            <button
                                type="button"
                                onClick={handleBulkMessage}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 dark:bg-zinc-900/20 text-sm font-medium hover:bg-white/30 dark:hover:bg-zinc-900/30 transition-colors"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                                Message
                            </button>"""

content = content.replace("""                            <button
                                type="button"
                                onClick={handleBulkMessage}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 dark:bg-zinc-900/20 text-sm font-medium hover:bg-white/30 dark:hover:bg-zinc-900/30 transition-colors"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                                Message
                            </button>""", bulk_ui)

# Add ConfirmDialog for bulk disconnect
bulk_dialog = """            <ConfirmDialog
                open={bulkDisconnectTarget}
                onOpenChange={setBulkDisconnectTarget}
                title="Disconnect from selected users"
                description={`Are you sure you want to disconnect from ${selectedIds.size} users?`}
                confirmLabel="Disconnect All"
                variant="destructive"
                onConfirm={() => {
                    setBulkDisconnectTarget(false);
                    toast.promise(bulkActions.disconnect.mutateAsync(Array.from(selectedIds)), {
                        loading: "Disconnecting...",
                        success: "Successfully disconnected from selected users.",
                        error: "Failed to disconnect from some users.",
                    });
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                }}
            />
        </div>
    );
}"""

content = content.replace("""        </div>\n    );\n}""", bulk_dialog)

with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

# =======================
# 2. PersonCard.tsx (Feature 5)
# =======================
with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

# I will pass onBlock to RelationshipMenuItems
if "onBlock" not in content:
    # First, let's update person-card-model.ts
    with open("src/components/people/person-card-model.ts", "r") as pm:
        pm_content = pm.read()
    
    pm_content = pm_content.replace('| "invite_to_project"\n    | "disconnect";', '| "invite_to_project"\n    | "disconnect"\n    | "block";')
    pm_content = pm_content.replace('connectedMenu.push({ key: "disconnect", label: "Disconnect", destructive: true });', 'connectedMenu.push({ key: "disconnect", label: "Disconnect", destructive: true });\n    }\n    connectedMenu.push({ key: "block", label: "Block Profile", destructive: true });\n    secondaryMenu.push({ key: "block", label: "Block Profile", destructive: true });\n')
    
    with open("src/components/people/person-card-model.ts", "w") as pm:
        pm.write(pm_content)
    
    # Now update PersonCard.tsx
    content = content.replace("onDisconnect?: (userId: string, connectionId?: string) => Promise<void>;", "onDisconnect?: (userId: string, connectionId?: string) => Promise<void>;\n    onBlock?: (userId: string) => Promise<void>;")
    
    menu_items_sig = """function RelationshipMenuItems({
    actions,
    onDisconnect,
    isProcessing,
}: {"""
    menu_items_sig_new = """function RelationshipMenuItems({
    actions,
    onDisconnect,
    onBlock,
    isProcessing,
}: {"""
    content = content.replace(menu_items_sig, menu_items_sig_new)
    
    menu_items_props = """    onDisconnect?: () => void;
    isProcessing?: boolean;
}) {"""
    menu_items_props_new = """    onDisconnect?: () => void;
    onBlock?: () => void;
    isProcessing?: boolean;
}) {"""
    content = content.replace(menu_items_props, menu_items_props_new)
    
    # Add rendering for block
    block_render = """                if (action.key === "disconnect") {
                    if (!onDisconnect) return null;
                    return (
                        <React.Fragment key={action.key}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuItem onClick={onDisconnect} disabled={isProcessing} variant="destructive">
                                <X className="w-4 h-4" />
                                {action.label}
                            </DropdownMenuItem>
                        </React.Fragment>
                    );
                }
                
                if (action.key === "block") {
                    if (!onBlock) return null;
                    return (
                        <React.Fragment key={action.key}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuItem onClick={onBlock} disabled={isProcessing} variant="destructive">
                                <Ban className="w-4 h-4" />
                                {action.label}
                            </DropdownMenuItem>
                        </React.Fragment>
                    );
                }"""
    content = re.sub(r'if \(action.key === "disconnect"\) \{.*?\}\s*\}', block_render, content, flags=re.DOTALL)
    
    # Handle block state in PersonCard
    content = content.replace("const [isDisconnecting, setIsDisconnecting] = useState(false);", "const [isDisconnecting, setIsDisconnecting] = useState(false);\n    const [isBlocking, setIsBlocking] = useState(false);")
    
    handle_block = """    const handleDisconnect = async () => {
        if (!onDisconnect) return;
        setIsDisconnecting(true);
        try {
            await onDisconnect(profile.id, profile.connectionId || undefined);
        } finally {
            setIsDisconnecting(false);
        }
    };
    
    const handleBlock = async () => {
        if (!onBlock) return;
        setIsBlocking(true);
        try {
            await onBlock(profile.id);
        } finally {
            setIsBlocking(false);
        }
    };"""
    content = content.replace("""    const handleDisconnect = async () => {
        if (!onDisconnect) return;
        setIsDisconnecting(true);
        try {
            await onDisconnect(profile.id, profile.connectionId || undefined);
        } finally {
            setIsDisconnecting(false);
        }
    };""", handle_block)

    content = content.replace("onDisconnect={handleDisconnect}", "onDisconnect={handleDisconnect}\n                                onBlock={handleBlock}")

    with open("src/components/people/PersonCard.tsx", "w") as f:
        f.write(content)

