import re
from collections import Counter

headers = Counter()
toc = []

with open('/docs/README.md') as f:
    for line in f:
        match = re.match(r'^(#+)\s+(.+)$', line)
        if match:
            level = len(match.group(1))
            title = match.group(2)
            headers[f'h{level}'] += 1
            indent = '  ' * (level - 1)
            toc.append(f'{indent}- {title}')

print('Table of Contents:')
for item in toc:
    print(item)

print()
print('Header counts:')
for level, count in sorted(headers.items()):
    print(f'  {level}: {count}')
