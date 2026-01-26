import json

TYPE_MAP = {
    'int': 'int',
    'str': 'str',
    'float': 'float',
    'bool': 'bool',
    'datetime': 'datetime'
}

with open('/project/schema.json') as f:
    schema = json.load(f)

print('from dataclasses import dataclass')
print('from datetime import datetime')
print()

for class_name, config in schema.items():
    print('@dataclass')
    print(f'class {class_name}:')
    for field_name, field_type in config['fields'].items():
        py_type = TYPE_MAP.get(field_type, 'Any')
        print(f'    {field_name}: {py_type}')
    print()
