import re

versions = []

with open('/docs/CHANGELOG.md') as f:
    content = f.read()

ver_pattern = r'## \[(.+?)\] - (.+)'
for match in re.finditer(ver_pattern, content):
    versions.append(match.group(1))

added = len(re.findall(r'^### Added', content, re.M))
changed = len(re.findall(r'^### Changed', content, re.M))
fixed = len(re.findall(r'^### Fixed', content, re.M))

print(f'Found {len(versions)} versions:')
for ver in versions:
    print(f'  - v{ver}')

print()
print('Change types across all versions:')
print(f'  Added sections: {added}')
print(f'  Changed sections: {changed}')
print(f'  Fixed sections: {fixed}')
