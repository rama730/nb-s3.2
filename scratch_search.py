import re

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("File size:", len(html))

# Let's find occurrences of BubbleContent
matches = [m.start() for m in re.finditer('BubbleContent', html)]
print("BubbleContent matches:", len(matches))
for i, idx in enumerate(matches[:10]):
    print(f"Match {i}: {html[idx-100:idx+200]}")
    print("-" * 50)
