import re
from html.parser import HTMLParser

class MessageDocsParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.output = []
        self.current_tag = []
        self.in_interesting_tag = False
        self.interest_tags = {'h1', 'h2', 'h3', 'h4', 'p', 'pre', 'code', 'ul', 'ol', 'li'}
        
    def handle_starttag(self, tag, attrs):
        if tag in self.interest_tags:
            self.in_interesting_tag = True
            self.current_tag = []
            
    def handle_endtag(self, tag):
        if tag in self.interest_tags:
            self.in_interesting_tag = False
            text = "".join(self.current_tag).strip()
            if text:
                text = re.sub(r'\s+', ' ', text)
                if tag.startswith('h'):
                    level = int(tag[1])
                    self.output.append(f"\n\n{'#' * level} {text}\n")
                elif tag == 'pre':
                    self.output.append(f"\n```tsx\n{text}\n```\n")
                elif tag == 'li':
                    self.output.append(f"- {text}\n")
                elif tag == 'p':
                    self.output.append(f"\n{text}\n")
                else:
                    self.output.append(f" {text} ")
                    
    def handle_data(self, data):
        if self.in_interesting_tag:
            self.current_tag.append(data)

with open('scratch_message.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL)
html = re.sub(r'<style.*?>.*?</style>', '', html, flags=re.DOTALL)
html = html.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')

parser = MessageDocsParser()
parser.feed(html)

with open('full_message_docs.md', 'w', encoding='utf-8') as f:
    f.write("".join(parser.output))

print("Parsed message docs. Output size:", len(parser.output))
