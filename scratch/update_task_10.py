import os
path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/artifacts/task.md"
with open(path, "r") as f: content = f.read()
content = content.replace("- [ ] 6. Snapshot Rollback for Bulk Actions", "- [x] 6. Snapshot Rollback for Bulk Actions")
with open(path, "w") as f: f.write(content)
