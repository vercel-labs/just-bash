import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  // Simplified version - just the part that fails
  const command = `
DATA=$(cat /tmp/data.json)
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "STOP_LINE=[$STOP_LINE]"
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
else
  TOTAL=$(echo "$DATA" | jq '.[0].sheets[0].rows | length')
  COUNT=$((TOTAL - START_IDX))
fi
echo "COUNT=[$COUNT]"
`;
  
  const result = await bash.exec(command);
  console.log('Exit code:', result.exitCode);
  console.log('Stdout:\n', result.stdout);
  console.log('Stderr:\n', result.stderr);
}

test().catch(console.error);

// Made with Bob
