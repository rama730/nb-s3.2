import re
from html.parser import HTMLParser

class FullDocsParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.output = []
        self.current_tag = []
        self.tags_stack = []
        self.in_interesting_tag = False
        
        # Tags we want to extract
        self.interest_tags = {'h1', 'h2', 'h3', 'h4', 'p', 'pre', 'code', 'ul', 'ol', 'li'}
        
    def handle_starttag(self, tag, attrs):
        self.tags_stack.append(tag)
        if tag in self.interest_tags:
            self.in_interesting_tag = True
            self.current_tag = []
            
    def handle_endtag(self, tag):
        if self.tags_stack:
            self.tags_stack.pop()
            
        if tag in self.interest_tags:
            self.in_interesting_tag = False
            text = "".join(self.current_tag).strip()
            if text:
                # Clean up multiple whitespaces
                text = re.sub(r'\s+', ' ', text)
                if tag.startswith('h'):
                    level = int(tag[1])
                    self.output.append(f"\n\n{'#' * level} {text}\n")
                elif tag == 'pre':
                    # For pre tags, let's keep formatting
                    raw_text = "".join(self.current_tag)
                    self.output.append(f"\n```tsx\n{raw_text}\n```\n")
                elif tag == 'li':
                    self.output.append(f"- {text}\n")
                elif tag == 'p':
                    self.output.append(f"\n{text}\n")
                else:
                    self.output.append(f" {text} ")
                    
    def handle_data(self, data):
        if self.in_interesting_tag:
            self.current_tag.append(data)

with open('scratch_content.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Let's clean up style/script blocks
html = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL)
html = re.sub(r'<style.*?>.*?</style>', '', html, flags=re.DOTALL)
# Convert HTML entities like &lt; and &quot; in pre blocks before parsing
html = html.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')

parser = FullDocsParser()
parser.feed(html)

with open('full_bubble_docs.md', 'w', encoding='utf-8') as f:
    f.write("".join(parser.output))

print("Parsed full docs. Output size:", len(parser.output))
