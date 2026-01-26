import re
from datetime import datetime

timestamps = []
pattern = r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})'

with open('/logs/app.log') as f:
    for line in f:
        match = re.match(pattern, line)
        if match:
            ts = datetime.strptime(match.group(1), '%Y-%m-%d %H:%M:%S')
            timestamps.append(ts)

if timestamps:
    duration = timestamps[-1] - timestamps[0]
    print(f'First entry: {timestamps[0].strftime("%H:%M:%S")}')
    print(f'Last entry: {timestamps[-1].strftime("%H:%M:%S")}')
    print(f'Time span: {int(duration.total_seconds() // 60)} minutes')
    print(f'Total entries: {len(timestamps)}')
