import os
path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/artifacts/task.md"
with open(path, "r") as f: content = f.read()
content = content.replace("- [ ] Refactor `getConnectionRequestHistory()`", "- [/] Refactor `getConnectionRequestHistory()`")
content = content.replace("- [ ] Update `RequestsTab.tsx` timeline renderer", "- [/] Update `RequestsTab.tsx` timeline renderer")
content = content.replace("- [ ] Update `RequestsTab.tsx` bulk-job polling", "- [/] Update `RequestsTab.tsx` bulk-job polling")
content = content.replace("- [ ] Expand `selectionMode` UI", "- [/] Expand `selectionMode` UI")
content = content.replace("- [ ] Modify `getConnectionsFeed` for discovery", "- [/] Modify `getConnectionsFeed` for discovery")
content = content.replace("- [ ] Retain contextual search groupings", "- [/] Retain contextual search groupings")
content = content.replace("- [ ] Add \"Block Profile\" dropdown action", "- [/] Add \"Block Profile\" dropdown action")
with open(path, "w") as f: f.write(content)
