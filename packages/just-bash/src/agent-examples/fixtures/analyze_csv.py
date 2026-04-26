import csv
from collections import defaultdict

revenue = defaultdict(float)
with open('/data/sales.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        product = row['product']
        total = int(row['quantity']) * float(row['price'])
        revenue[product] += total

for product in sorted(revenue.keys()):
    print(f'{product}: ${revenue[product]:.2f}')
