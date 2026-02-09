import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  // Test with simple data - grep no match | head
  console.log('=== REAL BASH: echo "[test]" | grep "nomatch" | head -1 ===');
  try {
    const realResult = execSync(`bash -c 'VAR=$(echo "[test]" | grep "nomatch" | head -1); echo "VAR=[$VAR]"'`, { encoding: 'utf-8' });
    console.log(realResult);
  } catch (e) {
    console.log('Exit:', e.status, 'Output:', e.stdout);
  }
  
  console.log('=== JUST-BASH: echo "[test]" | grep "nomatch" | head -1 ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`bash -c 'VAR=$(echo "[test]" | grep "nomatch" | head -1); echo "VAR=[\${VAR}]"'`);
  console.log(result.stdout);
  console.log('Exit:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
