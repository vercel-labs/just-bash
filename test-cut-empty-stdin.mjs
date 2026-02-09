import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  // Test with real bash - truly empty input to cut
  console.log('=== REAL BASH: true | cut -d: -f1 ===');
  const realResult = execSync(`true | cut -d: -f1`, { encoding: 'utf-8' });
  console.log('Output:', JSON.stringify(realResult));
  console.log('Hex:', Buffer.from(realResult).toString('hex'));
  
  // Test with just-bash
  console.log('\n=== JUST-BASH: true | cut -d: -f1 ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs, cwd: '/', env: { HOME: '/' } });
  
  const result = await bash.exec(`true | cut -d: -f1`);
  console.log('Output:', JSON.stringify(result.stdout));
  console.log('Hex:', Buffer.from(result.stdout).toString('hex'));
  console.log('Exit code:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
