import { Bash, InMemoryFs } from './dist/index.js';
import { execSync } from 'child_process';
import fs from 'fs';

async function test() {
  // Simple script that just reads stdin
  const scriptContent = 'cat';
  fs.writeFileSync('test-stdin.sh', scriptContent);
  
  const testData = 'hello world';
  const fullCommand = `echo "${testData}" | bash test-stdin.sh`;

  // Test with real bash
  console.log('=== REAL BASH ===');
  console.log('Command:', fullCommand);
  const realResult = execSync(fullCommand, { encoding: 'utf-8' });
  console.log('stdout:', JSON.stringify(realResult));
  
  // Test with just-bash
  console.log('\n=== JUST-BASH ===');
  console.log('Command:', fullCommand);
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs });
  await memFs.writeFile('test-stdin.sh', scriptContent);
  
  const result = await bash.exec(fullCommand);
  console.log('stdout:', JSON.stringify(result.stdout));
  console.log('stderr:', JSON.stringify(result.stderr));
  console.log('exit code:', result.exitCode);
}

test().catch(console.error);

// Made with Bob
