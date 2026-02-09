import { Bash, InMemoryFs } from 'just-bash';

async function test() {
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  // Minimal test case - just the [ -n "$VAR" ] test via bash -c
  console.log('=== Test 1: Empty variable in [ -n ] via bash -c ===');
  let result = await bash.exec(`bash -c 'VAR=""; if [ -n "$VAR" ]; then echo "not empty"; else echo "empty"; fi'`);
  console.log('Exit:', result.exitCode, 'Out:', result.stdout.trim(), 'Err:', result.stderr.trim());
  
  console.log('\n=== Test 2: Variable with brackets in [ -n ] via bash -c ===');
  result = await bash.exec(`bash -c 'VAR="["; if [ -n "$VAR" ]; then echo "not empty"; else echo "empty"; fi'`);
  console.log('Exit:', result.exitCode, 'Out:', result.stdout.trim(), 'Err:', result.stderr.trim());
  
  console.log('\n=== Test 3: Direct (no bash -c) ===');
  result = await bash.exec(`VAR="["; if [ -n "$VAR" ]; then echo "not empty"; else echo "empty"; fi`);
  console.log('Exit:', result.exitCode, 'Out:', result.stdout.trim(), 'Err:', result.stderr.trim());
}

test().catch(console.error);

// Made with Bob
