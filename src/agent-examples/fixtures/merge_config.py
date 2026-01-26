import json

def deep_merge(base, override):
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result

with open('/config/base.json') as f:
    base = json.load(f)

with open('/config/production.json') as f:
    prod = json.load(f)

merged = deep_merge(base, prod)

print('Merged production config:')
print(json.dumps(merged, indent=2))
