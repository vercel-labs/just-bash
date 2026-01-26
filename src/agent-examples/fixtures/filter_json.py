import json

with open('/data/users.json') as f:
    users = json.load(f)

admins = [u for u in users if u['role'] == 'admin']
print(f'Total users: {len(users)}')
print(f'Admin users: {len(admins)}')
print('Admin names:', ', '.join(u['name'] for u in admins))
