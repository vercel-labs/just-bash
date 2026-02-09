import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Test with real bash
  console.log('=== REAL BASH ===');
  const realResult = execSync(`cat excelData.json | bash -c 'DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | grep -n "\\"Source\\"" | tail -1 | cut -d: -f1 | awk "{print \\$1 - 1}")
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "STOP_LINE=[$STOP_LINE]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  await memFs.writeFile('/tmp/stdin_data', jsonData);
  
  const result = await bash.exec(`cat /tmp/stdin_data | bash -c 'DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | grep -n "\\"Source\\"" | tail -1 | cut -d: -f1 | awk "{print \\$1 - 1}")
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "STOP_LINE=[\${STOP_LINE}]"'`);
  
  console.log(result.stdout);
  if (result.stderr) console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
