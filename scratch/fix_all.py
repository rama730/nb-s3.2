import re

# 1. Fix src/app/actions/connections.ts
with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace("logger.error", "console.error")
content = content.replace("export async function withdrawAllSentConnectionRequests() {", "export async function withdrawAllSentConnectionRequests() {\n    const user = await getAuthUser();\n    if (!user) return { success: false, error: 'Not authenticated' };")
content = content.replace("import type { ConnectionStats } from '@/lib/connections/types';", "import type { ConnectionStats } from '@/lib/connections/types';\nimport type { DiscoverConnectionItem } from '@/hooks/useConnections';")
# Remove duplicate withdrawAllSentConnectionRequests if there is one
content = re.sub(r'export async function withdrawAllSentConnectionRequests\(\) \{\n\s*const user = await getAuthUser\(\);\n\s*if \(\!user\) return \{ success: false, error: \'Not authenticated\' \};\n\s*const user = await getAuthUser\(\);', "export async function withdrawAllSentConnectionRequests() {\n    const user = await getAuthUser();\n    if (!user) return { success: false, error: 'Not authenticated' };", content)

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

# 2. Fix src/components/people/ConnectionsClient.tsx
with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Fix imports
if "useConnectionTags" not in content and "useConnections" in content:
    content = content.replace('import { useConnections,', 'import { useConnections, useConnectionTags, useBulkConnectionsActions,')
    content = content.replace('import { useConnections }', 'import { useConnections, useConnectionTags, useBulkConnectionsActions }')

# The regex script added things multiple times because I didn't anchor it!
# I will just restore ConnectionsClient.tsx to git HEAD and re-apply correctly.
