import json

with open('/api/response.json') as f:
    data = json.load(f)

rows = []
for user in data['data']['users']:
    if user['posts']:
        for post in user['posts']:
            rows.append({
                'user_id': user['id'],
                'user_name': user['name'],
                'post_id': post['id'],
                'post_title': post['title']
            })
    else:
        rows.append({
            'user_id': user['id'],
            'user_name': user['name'],
            'post_id': None,
            'post_title': None
        })

print(f'Flattened {len(rows)} records:')
for row in rows:
    post_info = f"Post #{row['post_id']}: {row['post_title']}" if row['post_id'] else 'No posts'
    print(f"  User {row['user_name']}: {post_info}")
