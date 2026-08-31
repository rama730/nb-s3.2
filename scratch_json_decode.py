import json
import re

with open('extracted_bubble_component.tsx', 'r', encoding='utf-8') as f:
    raw = f.read()

# Since the file itself is a double-quoted JSON string (or similar), let's wrap it in double quotes and parse it
# Actually, the file has escaped double quotes \" and escaped newlines \n. Let's wrap it in double quotes as a JSON string and parse it.
try:
    # If the file starts with "import", we can just decode the escapes.
    # In python, we can do bytes(raw, "utf-8").decode("unicode_escape") or json.loads
    # Let's wrap it:
    json_str = '"' + raw + '"'
    decoded = json.loads(json_str)
    
    with open('bubble_component_cleaned.tsx', 'w', encoding='utf-8') as out:
        out.write(decoded)
    print("Decoded successfully using json.loads!")
except Exception as e:
    print("Failed to decode using json:", e)
    # Fallback to manual replacement
    decoded = raw.replace('\\"', '"').replace('\\n', '\n').replace('\\u003c', '<').replace('\\u003e', '>').replace('\\u0026', '&')
    with open('bubble_component_cleaned.tsx', 'w', encoding='utf-8') as out:
        out.write(decoded)
    print("Decoded successfully using fallback replacements!")
