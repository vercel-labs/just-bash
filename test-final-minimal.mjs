import { Bash, InMemoryFs } from 'just-bash';
import { execSync } from 'child_process';

async function test() {
  const testData = 'hello world';
  
  // Real bash - outputs: VAR=[hello world]
  console.log('=== REAL BASH ===');
  const cmd = 'DATA=$(cat); VAR=$(echo "$DATA"); echo "VAR=[$VAR]"';
  const realResult = execSync(`echo "${testData}" | bash -c '${cmd}'`, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Just-bash - outputs: (empty)
  console.log('=== JUST-BASH ===');
  const bash = new Bash({ fs: new InMemoryFs() });
  const result = await bash.exec(`echo "${testData}" | bash -c 'DATA=\\$(cat); VAR=\\$(echo "\\$DATA"); echo "VAR=[\\$VAR]"'`);
  console.log(result.stdout);
}

test();

// Made with Bob
