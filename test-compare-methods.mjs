import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function testDirect() {
  console.log('=== TEST 1: Direct command ===');
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  const command = `DATA=$(cat /tmp/data.json)
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
else
  TOTAL=$(echo "$DATA" | jq '.[0].sheets[0].rows | length')
  COUNT=$((TOTAL - START_IDX))
fi
echo "{\\"h\\": $HEADER_IDX, \\"s\\": $START_IDX, \\"n\\": $COUNT}"`;
  
  const result = await bash.exec(command);
  console.log('Exit code:', result.exitCode);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
}

async function testViaBashC() {
  console.log('\n=== TEST 2: Via bash -c (like original) ===');
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  
  await memFs.writeFile('/tmp/stdin_data', jsonData);
  
  const innerCommand = `DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
else
  TOTAL=$(echo "$DATA" | jq '.[0].sheets[0].rows | length')
  COUNT=$((TOTAL - START_IDX))
fi
echo "{\\"h\\": $HEADER_IDX, \\"s\\": $START_IDX, \\"n\\": $COUNT}"`;
  
  const fullCommand = `cat /tmp/stdin_data | bash -c '${innerCommand.replace(/'/g, "'\\''")}'`;
  
  const result = await bash.exec(fullCommand);
  console.log('Exit code:', result.exitCode);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
}

async function run() {
  await testDirect();
  await testViaBashC();
}

run().catch(console.error);

// Made with Bob
