import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  // Get the actual STOP_LINE value via bash -c
  console.log('=== Getting STOP_LINE value via bash -c ===');
  const cmd1 = `cat /tmp/data.json | bash -c 'DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | grep -n "\\"Source\\"" | tail -1 | cut -d: -f1 | awk "{print \\$1 - 1}")
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
echo "STOP_LINE=[\${STOP_LINE}]"
printf "STOP_LINE_HEX="; printf "%s" "\$STOP_LINE" | od -A n -t x1'`;
  
  let result = await bash.exec(cmd1);
  console.log('Exit:', result.exitCode);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
  
  // Now test the [ -n ] with that value
  console.log('\n=== Testing [ -n "$STOP_LINE" ] via bash -c ===');
  const cmd2 = `cat /tmp/data.json | bash -c 'DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | grep -n "\\"Source\\"" | tail -1 | cut -d: -f1 | awk "{print \\$1 - 1}")
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
if [ -n "$STOP_LINE" ]; then
  echo "STOP_LINE is not empty: [$STOP_LINE]"
else
  echo "STOP_LINE is empty"
fi'`;
  
  result = await bash.exec(cmd2);
  console.log('Exit:', result.exitCode);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
