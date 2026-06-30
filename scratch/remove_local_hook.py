import re

with open("src/components/people/PeopleHubClient.tsx", "r") as f:
    content = f.read()

# Replace the import
content = re.sub(r'useConnectionsRealtimeInvalidation(,?|\s)', r'', content)
# Remove the hook call
content = re.sub(r'\s*useConnectionsRealtimeInvalidation\(\);\s*', '\n', content)

with open("src/components/people/PeopleHubClient.tsx", "w") as f:
    f.write(content)

print("Removed!")
