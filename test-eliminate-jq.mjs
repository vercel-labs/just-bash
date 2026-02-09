import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // First, get the jq output
  console.log('=== Step 1: Get jq output ===');
  const jqOutput = execSync(`cat excelData.json | jq -c ".[0].sheets[0].rows[]"`, { encoding: 'utf-8' });
  console.log('Lines:', jqOutput.split('\n').length);
  fs.writeFileSync('jq-output.txt', jqOutput);
  
  // Test with real bash using the jq output directly
  console.log('\n=== REAL BASH: cat jq-output | tail | grep | head ===');
  const realResult = execSync(`bash -c 'VAR=$(cat jq-output.txt | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: cat jq-output | tail | grep | head ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/jq-output.txt', jqOutput);
  
  const result = await bash.exec(`bash -c 'VAR=$(cat /jq-output.txt | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  
  fs.unlinkSync('jq-output.txt');
}

test().catch(console.error);

// Made with Bob
