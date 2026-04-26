import csv
from collections import Counter

products = Counter()
total_quantity = 0
total_revenue = 0

with open('/data/sales.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        qty = int(row['quantity'])
        price = float(row['price'])
        products[row['product']] += qty
        total_quantity += qty
        total_revenue += qty * price

print(f'Total items sold: {total_quantity}')
print(f'Total revenue: ${total_revenue:.2f}')
print(f'Most popular: {products.most_common(1)[0][0]}')
print(f'Unique products: {len(products)}')
