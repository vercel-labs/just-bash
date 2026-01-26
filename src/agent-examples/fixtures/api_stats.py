import json

with open('/api/response.json') as f:
    data = json.load(f)

users = data['data']['users']
pagination = data['data']['pagination']

total_posts = sum(len(u['posts']) for u in users)
users_with_posts = sum(1 for u in users if u['posts'])
avg_posts = total_posts / len(users) if users else 0

print('API Response Statistics:')
print(f'  Status: {data["status"]}')
print(f'  Users in response: {len(users)}')
print(f'  Users with posts: {users_with_posts}')
print(f'  Total posts: {total_posts}')
print(f'  Average posts per user: {avg_posts:.1f}')
print(f'  Page: {pagination["page"]} of {pagination["total_pages"]}')
print(f'  Total items: {pagination["total_items"]}')
