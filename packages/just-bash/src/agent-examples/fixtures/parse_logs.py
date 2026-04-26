import re
from collections import Counter

levels = Counter()
errors = []

with open('/logs/app.log') as f:
    for line in f:
        match = re.match(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (\w+)', line)
        if match:
            level = match.group(1)
            levels[level] += 1
            if level == 'ERROR':
                parts = line.strip().split(' ', 3)
                if len(parts) >= 4:
                    errors.append(parts[3])

print('Log level counts:')
for level in ['INFO', 'DEBUG', 'WARN', 'ERROR']:
    print(f'  {level}: {levels[level]}')
print()
print(f'Errors found: {len(errors)}')
for err in errors:
    print(f'  - {err}')
