import { Bash, InMemoryFs } from './dist/index.js';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Test just the problematic pipeline step by step
  const command = `DATA=$(cat)
echo "=== Step 1: jq output (first 5 lines) ===" >&2
echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | head -5 >&2
echo "" >&2
echo "=== Step 2: after tail -n +43 (first 5 lines) ===" >&2
echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | head -5 >&2
echo "" >&2
echo "=== Step 3: grep -in TOTAL EXPENSES ===" >&2
echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES" >&2
echo "" >&2
echo "=== Step 4: after head -1 ===" >&2
echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1 >&2
echo "" >&2
echo "=== Step 5: after cut -d: -f1 ===" >&2
RESULT=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "RESULT=[$RESULT]" >&2`;

  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs });
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  const fullCommand = `cat /tmp/data.json | bash -c '${command.replace(/'/g, "'\\''")}'`;
  
  const result = await bash.exec(fullCommand);
  
  console.log('STDERR:');
  console.log(result.stderr);
}

test().catch(console.error);

// Made with Bob
