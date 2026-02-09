import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';
import fs from 'fs';

async function test() {
  const simpleJson = '[{"a":1},{"b":2}]';
  fs.writeFileSync('simple.json', simpleJson);
  
  // Test with real bash
  console.log('=== REAL BASH: jq | grep nomatch | head ===');
  const realResult = execSync(`bash -c 'VAR=$(cat simple.json | jq -c ".[]" | grep "nomatch" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: jq | grep nomatch | head ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  await memFs.writeFile('/simple.json', simpleJson);
  
  const result = await bash.exec(`bash -c 'VAR=$(cat /simple.json | jq -c ".[]" | grep "nomatch" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  
  fs.unlinkSync('simple.json');
}

test().catch(console.error);

// Made with Bob
