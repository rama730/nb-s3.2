import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Replace all naked `onSettled: invalidateAll,` and `onError: invalidateAll,` with arrow functions
content = re.sub(r"onSettled:\s*invalidateAll,", "onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),", content)
content = re.sub(r"onError:\s*invalidateAll,", "onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),", content)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

