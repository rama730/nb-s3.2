import re

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Search for forwardRef or cva or React.forwardRef or variant declarations in TSX style
matches = [m.start() for m in re.finditer(r'forwardRef|cva\(', html)]
print("Found forwardRef/cva matches:", len(matches))
for i, idx in enumerate(matches[:15]):
    print(f"Match {i}: {html[max(0, idx-100):idx+300]}")
    print("=" * 60)
