import re
import json

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's find the text around "const bubbleVariants = cva(" inside the HTML
# We saw that in the previous search, it was inside some JSON or HTML
# Let's find where it starts and ends and print the exact surrounding structure
cva_match = re.search(r'const bubbleVariants = cva', html)
if cva_match:
    idx = cva_match.start()
    print("Context around Match:")
    print(html[idx-300:idx+500])
else:
    print("Not found")
