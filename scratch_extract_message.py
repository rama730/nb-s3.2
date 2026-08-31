import re
import json

with open('scratch_message.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Search for forwardRef or cva or React.forwardRef or variant declarations in TSX style
matches = [m.start() for m in re.finditer(r'forwardRef|cva\(', html)]
print("Found forwardRef/cva matches in Message:", len(matches))
for i, idx in enumerate(matches[:5]):
    print(f"Match {i}: {html[max(0, idx-100):idx+300]}")
    print("=" * 60)
    
# Let's see if we can find the code block that defines Message component
cva_match = re.search(r'const messageVariants = cva\(', html)
if cva_match:
    start_idx = cva_match.start()
    import_matches = [m.start() for m in re.finditer(r'import\s+\{\s*cva', html)]
    if import_matches:
        valid_imports = [idx for idx in import_matches if idx < start_idx]
        if valid_imports:
            start_idx = valid_imports[-1]
            
    # Now, find the end of the code. It should end with something like "export { Message, MessageHeader, MessageFooter, MessageAvatar, MessageContent }"
    export_match = re.search(r'export\s+\{\s*Message[^}]*\}', html, flags=re.DOTALL)
    if export_match:
        end_idx = export_match.end()
    else:
        end_idx = start_idx + 8000
        
    code = html[start_idx:end_idx]
    code = code.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&#x27;', "'").replace('&#x2F;', "/")
    
    # Try decoding
    try:
        json_str = '"' + code + '"'
        decoded = json.loads(json_str)
        with open('message_component_cleaned.tsx', 'w', encoding='utf-8') as out:
            out.write(decoded)
        print("Extracted and decoded Message component code successfully!")
    except Exception as e:
        print("Failed to decode using JSON, doing replacement fallback:", e)
        decoded = code.replace('\\"', '"').replace('\\n', '\n').replace('\\u003c', '<').replace('\\u003e', '>').replace('\\u0026', '&')
        with open('message_component_cleaned.tsx', 'w', encoding='utf-8') as out:
            out.write(decoded)
else:
    print("messageVariants match not found in scratch_message.html")
