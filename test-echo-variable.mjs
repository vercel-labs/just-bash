import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const jqOutput = execSync(`cat excelData.json | jq -c ".[0].sheets[0].rows[]"`, { encoding: 'utf-8' });
  
  // Test with real bash - echo variable into pipeline
  console.log('=== REAL BASH: echo "$VAR" | tail | grep | head ===');
  const realResult = execSync(`bash -c 'DATA="${jqOutput.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"; VAR=$(echo "$DATA" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: echo "$VAR" | tail | grep | head ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`bash -c 'DATA="${jqOutput.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"; VAR=$(echo "$DATA" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
}

test().catch(console.error);

// Made with Bob
