import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  // Test with real bash - grep with no match | head | cut
  console.log('=== REAL BASH: echo "test" | grep "nomatch" | head -1 | cut -d: -f1 ===');
  try {
    const realResult = execSync(`bash -c 'VAR=$(echo "test" | grep "nomatch" | head -1 | cut -d: -f1); echo "VAR=[\${VAR}]"'`, { encoding: 'utf-8' });
    console.log('Output:', realResult);
  } catch (e) {
    console.log('Exit code:', e.status);
    console.log('Output:', e.stdout);
  }
  
  // Test with just-bash
  console.log('\n=== JUST-BASH: echo "test" | grep "nomatch" | head -1 | cut -d: -f1 ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`bash -c 'VAR=$(echo "test" | grep "nomatch" | head -1 | cut -d: -f1); echo "VAR=[\${VAR}]"'`);
  console.log('Output:', result.stdout);
  console.log('Stderr:', result.stderr);
  console.log('Exit code:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
