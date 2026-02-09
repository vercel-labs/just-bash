import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/', TMPDIR: '/tmp' } });
  
  await memFs.writeFile('/tmp/data.json', jsonData);
  
  // Step 1: Get rows after START_IDX
  console.log('=== Step 1: jq rows | tail -n +43 ===');
  let result = await bash.exec(`cat /tmp/data.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | head -5`);
  console.log('Output:', result.stdout);
  
  // Step 2: grep for TOTAL EXPENSES
  console.log('\n=== Step 2: grep -in "TOTAL EXPENSES" ===');
  result = await bash.exec(`cat /tmp/data.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES"`);
  console.log('Output:', result.stdout);
  console.log('Stderr:', result.stderr);
  
  // Step 3: head -1
  console.log('\n=== Step 3: head -1 ===');
  result = await bash.exec(`cat /tmp/data.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1`);
  console.log('Output:', result.stdout);
  console.log('Stderr:', result.stderr);
  
  // Step 4: cut -d: -f1
  console.log('\n=== Step 4: cut -d: -f1 ===');
  result = await bash.exec(`cat /tmp/data.json | jq -c '.[0].sheets[0].rows[]' | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1`);
  console.log('Output:', result.stdout);
  console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
