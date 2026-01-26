import re
from collections import Counter

status_codes = Counter()
endpoints = Counter()
methods = Counter()

pattern = r'"(\w+) ([^ ]+) HTTP/\d\.\d" (\d+)'

with open('/logs/access.log') as f:
    for line in f:
        match = re.search(pattern, line)
        if match:
            method, path, status = match.groups()
            methods[method] += 1
            endpoints[path] += 1
            status_codes[status] += 1

print('HTTP Methods:')
for method, count in methods.most_common():
    print(f'  {method}: {count}')

print()
print('Status Codes:')
for status, count in sorted(status_codes.items()):
    print(f'  {status}: {count}')

print()
print(f'Most accessed: {endpoints.most_common(1)[0][0]}')
