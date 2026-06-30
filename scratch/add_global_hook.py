import re

with open("src/components/providers/PeopleNotificationsProvider.tsx", "r") as f:
    content = f.read()

# Add import
import_stmt = 'import { useGlobalConnectionsRealtime } from "@/hooks/useConnections";\n'
content = content.replace('import { logger } from "@/lib/logger";', 'import { logger } from "@/lib/logger";\n' + import_stmt)

# Add hook call inside PeopleNotificationsProvider
hook_call = '  useGlobalConnectionsRealtime();\n'
content = content.replace('const { user } = useAuthContext();', 'const { user } = useAuthContext();\n' + hook_call)

with open("src/components/providers/PeopleNotificationsProvider.tsx", "w") as f:
    f.write(content)

print("Added global hook!")
