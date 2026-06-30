import re

# 1. connections.ts
with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace("export async function getConnectionRequestHistory(", "export async function getConnectionRequestHistory(") # Dummy
content = content.replace("items: [], error: 'Not authenticated' }", "items: [], groupedItems: [], error: 'Not authenticated' }")
content = content.replace("items: [], error: 'Failed to fetch connection request history'", "items: [], groupedItems: [], error: 'Failed to fetch connection request history'")

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

# 2. PersonCard.tsx
with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

sig_old = """function PersonCard({
    profile,
    onConnect,
    onDisconnect,
    onDismiss,
    isConnecting,
    variant = "network",
    priority = false,
    actions,
    connectedAt,
    requestedAt,
    viewerProjectIds,
    viewerSkills,
    viewerLocation,
}: PersonCardProps) {"""

sig_new = """function PersonCard({
    profile,
    onConnect,
    onDisconnect,
    onBlock,
    onDismiss,
    isConnecting,
    variant = "network",
    priority = false,
    actions,
    connectedAt,
    requestedAt,
    viewerProjectIds,
    viewerSkills,
    viewerLocation,
}: PersonCardProps) {"""

content = content.replace(sig_old, sig_new)

with open("src/components/people/PersonCard.tsx", "w") as f:
    f.write(content)

# 3. RequestsTab.tsx
with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Make sure useQuery is imported
if "import { useQuery } from '@tanstack/react-query';" not in content:
    content = "import { useQuery } from '@tanstack/react-query';\n" + content

# Fix any type
content = content.replace("refetchInterval: (query) =>", "refetchInterval: (query: any) =>")

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

