import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  // Test with real bash - command substitution with empty grep | cut
  console.log('=== REAL BASH: VAR=$(true | cut -d: -f1) ===');
  const realResult = execSync(`bash -c 'VAR=$(true | cut -d: -f1); echo "VAR=[\${VAR}]"'`, { encoding: 'utf-8' });
  console.log('Output:', realResult);
  
  // Test with just-bash
  console.log('=== JUST-BASH: VAR=$(true | cut -d: -f1) ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`bash -c 'VAR=$(true | cut -d: -f1); echo "VAR=[\${VAR}]"'`);
  console.log('Output:', result.stdout);
  console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
