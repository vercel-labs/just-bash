import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function testCommand(desc, innerPipeline) {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  const cmd = `DATA=$(cat); VAR=$(${innerPipeline}); echo "VAR=[$VAR]"`;
  const realResult = execSync(`cat excelData.json | bash -c '${cmd}'`, { encoding: 'utf-8' });
  
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/data.json', jsonData);
  
  const result = await bash.exec(`cat /data.json | bash -c '${cmd.replace(/\$/g, '\\$')}'`);
  
  const match = realResult.trim() === result.stdout.trim();
  console.log(`${match ? '✓' : '✗'} ${desc}`);
  if (!match) {
    console.log(`  Real: ${JSON.stringify(realResult.trim())}`);
    console.log(`  Just: ${JSON.stringify(result.stdout.trim())}`);
  }
}

async function test() {
  console.log('Working backwards from the inner pipeline:\n');
  
  await testCommand('Full: jq | tail | grep | head', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1');
  
  await testCommand('Remove head', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES"');
  
  await testCommand('Remove grep', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | head -1');
  
  await testCommand('Remove tail', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | grep -in "TOTAL EXPENSES" | head -1');
  
  await testCommand('Just jq | head', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | head -1');
  
  await testCommand('Just jq', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]"');
}

test().catch(console.error);

// Made with Bob
