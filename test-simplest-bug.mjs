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
    console.log(`  Real: ${JSON.stringify(realResult.trim().substring(0, 50))}`);
    console.log(`  Just: ${JSON.stringify(result.stdout.trim().substring(0, 50))}`);
  }
}

async function test() {
  console.log('Testing simpler cases:\n');
  
  await testCommand('echo "$DATA" | jq', 'echo "$DATA" | jq -c ".[0].sheets[0].rows[]"');
  
  await testCommand('echo "$DATA" | head', 'echo "$DATA" | head -1');
  
  await testCommand('echo "$DATA"', 'echo "$DATA"');
  
  await testCommand('cat (no echo)', 'cat');
}

test().catch(console.error);

// Made with Bob
