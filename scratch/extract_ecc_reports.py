import json
import os

transcript_path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/.system_generated/logs/transcript.jsonl"
output_path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/scratch/ecc_subagent_reports.json"

reports = {}

if os.path.exists(transcript_path):
    with open(transcript_path, "r") as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get("type") == "MODEL_MESSAGE_RECEIVED":
                    sender = event.get("content", {}).get("sender", "")
                    content = event.get("content", {}).get("content", "")
                    # Check if it's from our newly spawned subagents (by looking for "[CRITICAL]" or "[HIGH]")
                    if "[CRITICAL]" in content or "[HIGH]" in content or "[MEDIUM]" in content or "have completed" in content:
                        reports[sender] = content
            except:
                pass

with open(output_path, "w") as f:
    json.dump(reports, f, indent=2)

print(f"Extracted {len(reports)} potential subagent messages.")
