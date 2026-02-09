import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  const simpleJson = '[{"a":1},{"b":2}]';
  
  // Test with real bash
  console.log('=== REAL BASH: jq | grep nomatch | head ===');
  const realResult = execSync(`bash -c 'VAR=$(echo '${simpleJson}' | jq -c ".[]" | grep "nomatch" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: jq | grep nomatch | head ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`bash -c 'VAR=$(echo '${simpleJson}' | jq -c ".[]" | grep "nomatch" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
}

test().catch(console.error);

// Made with Bob
