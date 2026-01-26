import os

input_dir = '/input'
results = []

for filename in sorted(os.listdir(input_dir)):
    if filename.endswith('.txt'):
        filepath = os.path.join(input_dir, filename)
        data = {}
        with open(filepath) as f:
            for line in f:
                if ':' in line:
                    key, value = line.strip().split(': ', 1)
                    data[key] = value

        if int(data.get('age', 0)) > 28:
            results.append(f"{data['name']} ({data['age']}) - {data['occupation']} in {data['city']}")

print('People over 28:')
for r in results:
    print(f'  {r}')
print()
print(f'Total: {len(results)}')
