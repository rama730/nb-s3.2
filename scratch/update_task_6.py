import os
path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/artifacts/task.md"
with open(path, "r") as f: content = f.read()
content = content.replace("- [/] Refactor `getConnectionRequestHistory()`", "- [x] Refactor `getConnectionRequestHistory()`")
content = content.replace("- [/] Update `RequestsTab.tsx` timeline renderer", "- [x] Update `RequestsTab.tsx` timeline renderer")
content = content.replace("- [/] Update `RequestsTab.tsx` bulk-job polling", "- [x] Update `RequestsTab.tsx` bulk-job polling")
content = content.replace("- [/] Expand `selectionMode` UI", "- [x] Expand `selectionMode` UI")
content = content.replace("- [/] Modify `getConnectionsFeed` for discovery", "- [x] Modify `getConnectionsFeed` for discovery")
content = content.replace("- [/] Retain contextual search groupings", "- [x] Retain contextual search groupings")
content = content.replace("- [/] Add \"Block Profile\" dropdown action", "- [x] Add \"Block Profile\" dropdown action")
with open(path, "w") as f: f.write(content)
