import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Simplified command with debugging
  const command = `DATA=$(cat)
echo "DEBUG: DATA length = \${#DATA}" >&2
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
echo "DEBUG: HEADER_IDX = [$HEADER_IDX]" >&2
START_IDX=$((HEADER_IDX + 1))
echo "DEBUG: START_IDX = [$START_IDX]" >&2
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "DEBUG: STOP_LINE = [$STOP_LINE]" >&2
echo "Final: h=$HEADER_IDX, s=$START_IDX, stop=$STOP_LINE"`;

  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  const fullCommand = `cat /tmp/data.json | bash -c '${command.replace(/'/g, "'\\''")}'`;
  
  console.log('Executing...\n');
  const result = await bash.exec(fullCommand);
  
  console.log('STDOUT:');
  console.log(result.stdout);
  console.log('\nSTDERR:');
  console.log(result.stderr);
  console.log('\nExit code:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
