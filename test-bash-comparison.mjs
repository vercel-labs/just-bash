import { Bash, InMemoryFs } from './dist/index.js';
import { execSync } from 'child_process';

async function test() {
  console.log('=== TEST 1: Without bash -c ===');
  const command1 = `RESULT=$(echo "test" | grep "nomatch" | head -1); echo "RESULT=[$RESULT]"`;
  
  // Real bash
  console.log('REAL BASH:');
  try {
    const realResult = execSync(command1, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('stdout:', realResult);
  } catch (e) {
    console.log('stdout:', e.stdout);
    console.log('exit code:', e.status);
  }
  
  // Just-bash
  console.log('\nJUST-BASH:');
  const bash1 = new Bash({ fs: new InMemoryFs() });
  const result1 = await bash1.exec(command1);
  console.log('stdout:', result1.stdout);
  console.log('exit code:', result1.exitCode);
  
  console.log('\n=== TEST 2: With bash -c ===');
  const command2 = `echo "test" | bash -c 'RESULT=$(cat | grep "nomatch" | head -1); echo "RESULT=[$RESULT]"'`;
  
  // Real bash
  console.log('REAL BASH:');
  try {
    const realResult = execSync(command2, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('stdout:', realResult);
  } catch (e) {
    console.log('stdout:', e.stdout);
    console.log('exit code:', e.status);
  }
  
  // Just-bash
  console.log('\nJUST-BASH:');
  const bash2 = new Bash({ fs: new InMemoryFs() });
  const result2 = await bash2.exec(command2);
  console.log('stdout:', result2.stdout);
  console.log('exit code:', result2.exitCode);
}

test().catch(console.error);

// Made with Bob
