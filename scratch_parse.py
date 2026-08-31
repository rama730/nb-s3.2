import re
from html.parser import HTMLParser

class ShadcnParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_code = False
        self.in_heading = False
        self.heading_tag = ""
        self.code_text = []
        self.current_heading = []
        self.headings_and_code = []
        
    def handle_starttag(self, tag, attrs):
        if tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            self.in_heading = True
            self.heading_tag = tag
            self.current_heading = []
        elif tag == 'code':
            self.in_code = True
            self.code_text = []
            
    def handle_endtag(self, tag):
        if tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            self.in_heading = False
            heading_str = "".join(self.current_heading).strip()
            self.headings_and_code.append((self.heading_tag, heading_str))
        elif tag == 'code':
            self.in_code = False
            code_str = "".join(self.code_text).strip()
            if len(code_str) > 50:  # Only look at non-trivial code snippets
                self.headings_and_code.append(('code', code_str))
                
    def handle_data(self, data):
        if self.in_heading:
            self.current_heading.append(data)
        elif self.in_code:
            self.code_text.append(data)

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

# Let's strip script and style tags to make it cleaner
html_content = re.sub(r'<script.*?>.*?</script>', '', html_content, flags=re.DOTALL)
html_content = re.sub(r'<style.*?>.*?</style>', '', html_content, flags=re.DOTALL)

parser = ShadcnParser()
parser.feed(html_content)

with open('extracted_bubble_docs.txt', 'w', encoding='utf-8') as out:
    for item_type, content in parser.headings_and_code:
        out.write(f"=== {item_type.upper()} ===\n")
        out.write(content)
        out.write("\n\n")

print(f"Extracted {len(parser.headings_and_code)} items.")
