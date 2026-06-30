import re

with open("src/components/people/PeopleHubClient.tsx", "r") as f:
    content = f.read()

content = content.replace("import { useConnectionStats, useConnectionsRealtimeInvalidation } from \"@/hooks/useConnections\";", "import { useConnectionStats } from \"@/hooks/useConnections\";")
content = re.sub(r'\s*useConnectionsRealtimeInvalidation\(\);\s*', '\n', content)

with open("src/components/people/PeopleHubClient.tsx", "w") as f:
    f.write(content)

with open("src/components/providers/PeopleNotificationsProvider.tsx", "r") as f:
    content = f.read()

content = content.replace("import { useConnectionsRealtimeInvalidation } from \"@/hooks/useConnections\";", "import { useGlobalConnectionsRealtime } from \"@/hooks/useConnections\";")
content = re.sub(r'\s*useConnectionsRealtimeInvalidation\(\);\s*', '\n    useGlobalConnectionsRealtime();\n', content)

with open("src/components/providers/PeopleNotificationsProvider.tsx", "w") as f:
    f.write(content)
