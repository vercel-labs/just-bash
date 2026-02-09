import { Bash, InMemoryFs } from './dist/index.js';

async function test() {
  const env = new Bash({ fs: new InMemoryFs() });
  
  console.log('=== Test 1: Direct test (like in test-final-minimal.mjs) ===');
  const result1 = await env.exec('echo "hello world" | bash -c \'DATA=$(cat); VAR=$(echo "$DATA"); echo "VAR=[$VAR]"\'');
  console.log('stdout:', JSON.stringify(result1.stdout));
  console.log('stderr:', JSON.stringify(result1.stderr));
  console.log('exitCode:', result1.exitCode);
  
  console.log('\n=== Test 2: With escaped $ (like in test-final-minimal.mjs) ===');
  const result2 = await env.exec('echo "hello world" | bash -c \'DATA=\\$(cat); VAR=\\$(echo "\\$DATA"); echo "VAR=[\\$VAR]"\'');
  console.log('stdout:', JSON.stringify(result2.stdout));
  console.log('stderr:', JSON.stringify(result2.stderr));
  console.log('exitCode:', result2.exitCode);
}

test();

// Made with Bob
