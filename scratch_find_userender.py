with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

import re
matches = [m.start() for m in re.finditer('useRender', html, re.IGNORECASE)]
print("Matches found:", len(matches))
for i, idx in enumerate(matches[:5]):
    print(f"Match {i}: {html[idx-50:idx+150]}")
    print("-" * 50)
