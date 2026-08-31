import re

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's search for "bubbleVariants = cva" and find the beginning and end of the code segment.
# Typically, the code segment is within a code block, which is wrapped in a tag. Let's find the indices.
cva_match = re.search(r'const bubbleVariants = cva\(', html)
if cva_match:
    start_idx = cva_match.start()
    # Let's find the nearest "import * as" or "import {" before start_idx
    import_matches = [m.start() for m in re.finditer(r'import\s+\{\s*cva', html)]
    if import_matches:
        # Find the latest one before start_idx
        valid_imports = [idx for idx in import_matches if idx < start_idx]
        if valid_imports:
            start_idx = valid_imports[-1]
            
    # Now, find the end of the code. It should end with something like "export { Bubble, BubbleContent, BubbleReactions, BubbleGroup }"
    export_match = re.search(r'export\s+\{\s*Bubble[^}]*\}', html, flags=re.DOTALL)
    if export_match:
        end_idx = export_match.end()
    else:
        # fallback, get 5000 characters
        end_idx = start_idx + 8000
        
    code = html[start_idx:end_idx]
    
    # Unescape HTML entities
    code = code.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&#x27;', "'").replace('&#x2F;', "/")
    
    # Save the extracted code
    with open('extracted_bubble_component.tsx', 'w', encoding='utf-8') as f_out:
        f_out.write(code)
    print("Extracted code. Length:", len(code))
else:
    print("cva match not found.")
