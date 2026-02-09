import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  // Test without cut
  console.log('=== Without cut (just grep | head) ===');
  let result = await bash.exec(`cat /tmp/data.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  
  // Test without head
  console.log('=== Without head (just grep | cut) ===');
  result = await bash.exec(`cat /tmp/data.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | cut -d: -f1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  
  // Test without grep
  console.log('=== Without grep (just tail | head | cut) ===');
  result = await bash.exec(`cat /tmp/data.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | head -1 | cut -d: -f1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
}

test().catch(console.error);

// Made with Bob
