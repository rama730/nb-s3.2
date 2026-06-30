import re

with open("src/hooks/useConnections.ts", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.strip() == "},":
        # Check if previous line has clearTimeout
        if "clearTimeout" in lines[i-1]:
            lines[i] = "            }\n"
    if line.strip() == "return snapshots;,":
        lines[i] = "        return snapshots;\n"
    if line.strip() == "};" and "return snapshots" in lines[i-1]:
        # wait, line 1078 is "return snapshots;," and line 1079 is "};"
        # actually, optimisticallyDismissSuggestion doesn't have a trailing comma normally.
        pass

with open("src/hooks/useConnections.ts", "w") as f:
    f.writelines(lines)

print("Fixed syntax 2")
