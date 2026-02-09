import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Test with real bash - just the grep part
  console.log('=== REAL BASH: grep output ===');
  try {
    const realResult = execSync(`cat excelData.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES"`, { encoding: 'utf-8' });
    console.log('Output:', JSON.stringify(realResult));
  } catch (e) {
    console.log('Exit code:', e.status);
    console.log('Output:', JSON.stringify(e.stdout));
  }
  
  // Test with just-bash
  console.log('\n=== JUST-BASH: grep output ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  const result = await bash.exec(`cat /tmp/data.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES"`);
  console.log('Output:', JSON.stringify(result.stdout));
  console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
