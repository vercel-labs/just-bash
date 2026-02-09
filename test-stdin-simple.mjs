import { Bash, InMemoryFs } from './dist/index.js';

async function test() {
  console.log('=== Test 1: Without leading slash ===');
  const memFs1 = new InMemoryFs();
  const bash1 = new Bash({ fs: memFs1 });
  await memFs1.writeFile('test.sh', 'cat');
  const result1 = await bash1.exec('echo "hello" | bash test.sh');
  console.log('stdout:', JSON.stringify(result1.stdout));
  console.log('stderr:', JSON.stringify(result1.stderr));
  console.log('exitCode:', result1.exitCode);
  
  console.log('\n=== Test 2: With leading slash ===');
  const memFs2 = new InMemoryFs();
  const bash2 = new Bash({ fs: memFs2 });
  await memFs2.writeFile('/test.sh', 'cat');
  const result2 = await bash2.exec('echo "hello" | bash /test.sh');
  console.log('stdout:', JSON.stringify(result2.stdout));
  console.log('stderr:', JSON.stringify(result2.stderr));
  console.log('exitCode:', result2.exitCode);
  
  console.log('\n=== Test 3: Using files option ===');
  const bash3 = new Bash({
    files: {
      '/test.sh': 'cat'
    }
  });
  const result3 = await bash3.exec('echo "hello" | bash /test.sh');
  console.log('stdout:', JSON.stringify(result3.stdout));
  console.log('stderr:', JSON.stringify(result3.stderr));
  console.log('exitCode:', result3.exitCode);
}

test().catch(console.error);

// Made with Bob
