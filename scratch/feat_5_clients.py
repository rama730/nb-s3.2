import re
import glob

files = glob.glob("src/components/people/**/*Client.tsx", recursive=True)

for file in files:
    with open(file, "r") as f:
        content = f.read()

    # Pass onBlock
    if "const { disconnect," not in content and "const { disconnect }" in content:
        content = content.replace("const { disconnect } = useConnectionMutations();", "const { disconnect, blockProfile } = useConnectionMutations();")
    
    if "const { cancelRequest," not in content and "const { cancelRequest }" in content:
         content = content.replace("const { cancelRequest } = useConnectionMutations();", "const { cancelRequest, blockProfile } = useConnectionMutations();")

    # Add onBlock to PersonCard props
    if "onDisconnect={" in content and "onBlock={" not in content:
        content = content.replace("onDisconnect={confirmDisconnect}", "onDisconnect={confirmDisconnect}\n                                            onBlock={async (id) => { await blockProfile.mutateAsync(id); }}")
        content = content.replace("onDisconnect={async (id) => setDisconnectTarget({ id, name: conn.fullName || conn.username || id })}", "onDisconnect={async (id) => setDisconnectTarget({ id, name: conn.fullName || conn.username || id })}\n                                                        onBlock={async (id) => { await blockProfile.mutateAsync(id); }}")

    with open(file, "w") as f:
        f.write(content)

