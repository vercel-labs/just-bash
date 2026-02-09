import { Bash, InMemoryFs } from 'just-bash';

async function test() {
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  console.log('=== Test: STOP_LINE="[" with arithmetic via bash -c ===');
  const result = await bash.exec(`bash -c 'STOP_LINE="["
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
  echo "COUNT=$COUNT"
else
  echo "empty"
fi'`);
  
  console.log('Exit:', result.exitCode);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
  
  console.log('\n=== Compare with real bash ===');
}

test().catch(console.error);

// Made with Bob
