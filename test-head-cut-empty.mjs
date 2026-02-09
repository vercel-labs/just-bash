import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  // Test with real bash - empty input to head | cut
  console.log('=== REAL BASH: empty | head -1 | cut -d: -f1 ===');
  const realResult = execSync(`echo -n "" | head -1 | cut -d: -f1`, { encoding: 'utf-8' });
  console.log('Output:', JSON.stringify(realResult));
  console.log('Length:', realResult.length);
  
  // Test with just-bash
  console.log('\n=== JUST-BASH: empty | head -1 | cut -d: -f1 ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`echo -n "" | head -1 | cut -d: -f1`);
  console.log('Output:', JSON.stringify(result.stdout));
  console.log('Length:', result.stdout.length);
  console.log('Exit code:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
