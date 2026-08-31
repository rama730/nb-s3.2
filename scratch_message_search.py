import re

with open('scratch_message.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's search for occurrences of "Message" or "MessageAvatar" or "MessageContent"
matches = [m.start() for m in re.finditer(r'MessageAvatar|MessageContent|MessageHeader', html)]
print("Found matches:", len(matches))
for i, idx in enumerate(matches[:10]):
    print(f"Match {i}: {html[idx-100:idx+200]}")
    print("-" * 50)
