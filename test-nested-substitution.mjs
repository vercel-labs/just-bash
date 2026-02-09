import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Test with real bash - nested command substitution
  console.log('=== REAL BASH: DATA=$(cat) then echo "$DATA" | jq ===');
  const realResult = execSync(`cat excelData.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: DATA=$(cat) then echo "$DATA" | jq ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/data.json', jsonData);
  
  const result = await bash.exec(`cat /data.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
