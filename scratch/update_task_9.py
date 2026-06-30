import os
path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/artifacts/task.md"
with open(path, "r") as f: content = f.read()
content = content.replace("- [ ] 4. Fix Profile Optimistic Updates", "- [x] 4. Fix Profile Optimistic Updates")
content = content.replace("- [ ] 5. Optimistic Network Inserts & Smooth Suggestion Lanes", "- [x] 5. Optimistic Network Inserts & Smooth Suggestion Lanes\n- [ ] 6. Snapshot Rollback for Bulk Actions (`RequestsTab.tsx`)")
with open(path, "w") as f: f.write(content)
