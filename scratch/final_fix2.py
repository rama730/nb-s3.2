import re

with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Make sure allTags is defined
if "const allTags = " not in content and "const allTags =" not in content:
    content = content.replace("const stats = statsData || {", "const allTags: string[] = [];\n    const stats = statsData || {")

with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# Add import
if "DiscoverConnectionItem" not in content[:1000]:
    content = "import type { DiscoverConnectionItem } from '@/hooks/useConnections';\n" + content

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

