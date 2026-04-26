import re

env_vars = {}
issues = []

with open('/config/.env.example') as f:
    for line_num, line in enumerate(f, 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue

        if '=' not in line:
            issues.append(f'Line {line_num}: Missing = sign')
            continue

        key, value = line.split('=', 1)

        if not re.match(r'^[A-Z][A-Z0-9_]*$', key):
            issues.append(f'Line {line_num}: Invalid key format: {key}')

        env_vars[key] = value

print('Environment variables:')
for key, value in env_vars.items():
    display = '***' if 'KEY' in key or 'SECRET' in key or 'PASSWORD' in key else value
    print(f'  {key}={display}')

print()
print(f'Total: {len(env_vars)} variables')
if issues:
    print()
    print('Issues found:')
    for issue in issues:
        print(f'  - {issue}')
else:
    print()
    print('No issues found')
