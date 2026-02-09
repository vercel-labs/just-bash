import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Simplest possible test with the actual data
  console.log('=== REAL BASH: DATA=$(cat) then echo "$DATA" | jq | tail +43 | grep | head ===');
  const realResult = execSync(`cat excelData.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  console.log('=== JUST-BASH: same command ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/data.json', jsonData);
  
  const result = await bash.exec(`cat /data.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
}

test().catch(console.error);

// Made with Bob
