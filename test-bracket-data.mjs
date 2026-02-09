import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';
import fs from 'fs';

async function test() {
  // Create JSON that starts with [ like the Excel data
  const jsonData = '[{"test":"value"}]';
  fs.writeFileSync('bracket.json', jsonData);
  
  // Test with real bash
  console.log('=== REAL BASH ===');
  const realResult = execSync(`bash -c 'DATA=$(cat bracket.json); VAR=$(echo "$DATA" | jq -c ".[]" | tail -n +2 | grep "nomatch" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/bracket.json', jsonData);
  
  const result = await bash.exec(`bash -c 'DATA=$(cat /bracket.json); VAR=$(echo "$DATA" | jq -c ".[]" | tail -n +2 | grep "nomatch" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  
  fs.unlinkSync('bracket.json');
}

test().catch(console.error);

// Made with Bob
