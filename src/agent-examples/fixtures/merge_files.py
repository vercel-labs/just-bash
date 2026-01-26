import os
import json

records = []
input_dir = '/input'

for filename in sorted(os.listdir(input_dir)):
    if filename.endswith('.txt'):
        filepath = os.path.join(input_dir, filename)
        record = {}
        with open(filepath) as f:
            for line in f:
                if ':' in line:
                    key, value = line.strip().split(': ', 1)
                    if key == 'age':
                        value = int(value)
                    record[key] = value
        records.append(record)

print(json.dumps(records, indent=2))
