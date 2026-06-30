import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

old_type = """type ConnectionsRealtimePayload = {
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
};"""

new_type = """type ConnectionsRealtimePayload = {
    eventType?: string;
    new?: Record<string, any>;
    old?: Record<string, any>;
};"""

content = content.replace(old_type, new_type)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

