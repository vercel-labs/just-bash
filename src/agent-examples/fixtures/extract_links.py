import re

links = []

with open('/docs/README.md') as f:
    content = f.read()

link_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
for match in re.finditer(link_pattern, content):
    links.append({'text': match.group(1), 'url': match.group(2)})

print(f'Found {len(links)} links:')
for link in links:
    print(f'  [{link["text"]}] -> {link["url"]}')
