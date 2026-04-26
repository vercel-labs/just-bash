import csv
import re
from datetime import datetime

def validate_email(email):
    if not email:
        return False, 'Empty email'
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False, 'Invalid format'
    return True, None

def validate_phone(phone):
    digits = re.sub(r'[^0-9]', '', phone)
    if len(digits) < 7 or len(digits) > 15:
        return False, 'Invalid length'
    return True, None

def validate_date(date_str):
    try:
        datetime.strptime(date_str, '%Y-%m-%d')
        return True, None
    except ValueError:
        return False, 'Invalid format'

errors = []
valid_count = 0

with open('/data/users.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        row_errors = []

        valid, err = validate_email(row['email'])
        if not valid:
            row_errors.append(f'email: {err}')

        valid, err = validate_phone(row['phone'])
        if not valid:
            row_errors.append(f'phone: {err}')

        valid, err = validate_date(row['created_at'])
        if not valid:
            row_errors.append(f'date: {err}')

        if row_errors:
            errors.append(f"Row {row['id']}: {', '.join(row_errors)}")
        else:
            valid_count += 1

print('Validation Results:')
print(f'  Valid rows: {valid_count}')
print(f'  Invalid rows: {len(errors)}')
print()
print('Errors:')
for err in errors:
    print(f'  {err}')
