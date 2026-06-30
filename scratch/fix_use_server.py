with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# Make sure "use server"; is at the top
if '"use server";' not in content and "'use server';" not in content:
    content = '"use server";\n\nimport type { DiscoverConnectionItem } from "@/hooks/useConnections";\n' + content

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

