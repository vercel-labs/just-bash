import json

SQL_TYPE_MAP = {
    'int': 'INTEGER',
    'str': 'VARCHAR(255)',
    'float': 'DECIMAL(10,2)',
    'bool': 'BOOLEAN',
    'datetime': 'TIMESTAMP'
}

with open('/project/schema.json') as f:
    schema = json.load(f)

for table_name, config in schema.items():
    table_lower = table_name.lower() + 's'
    print(f'CREATE TABLE {table_lower} (')
    fields = list(config['fields'].items())
    for i, (field_name, field_type) in enumerate(fields):
        sql_type = SQL_TYPE_MAP.get(field_type, 'TEXT')
        pk = ' PRIMARY KEY' if field_name == 'id' else ''
        comma = ',' if i < len(fields) - 1 else ''
        print(f'    {field_name} {sql_type}{pk}{comma}')
    print(');')
    print()
