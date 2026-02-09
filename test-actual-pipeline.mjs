import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import { execSync } from 'child_process';

async function test() {
  const jsonData = fs.readFileSync('excelData.json', 'utf-8');
  
  // Test the exact failing pipeline with real bash
  console.log('=== REAL BASH ===');
  const realCmd = `cat excelData.json | bash -c 'DATA=$(cat); VAR=$(echo "$DATA" | jq -c ".[0].sheets[0].rows[]" | tail -n +43 | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1); echo "VAR=[$VAR]"'`;
  const realResult = execSync(realCmd, { encoding: 'utf-8' });
  console.log(realResult);
  
  // Test with just-bash using the SAME command
  console.log('=== JUST-BASH ===');
  const memFs = new InMemoryFs();
  const bash = new Bash({ fs: memFs });
  await memFs.writeFile('excelData.json', jsonData);
  
  // Use the exact same realCmd
  const result = await bash.exec(realCmd);
  console.log(result.stdout);
  if (result.stderr) console.log('Stderr:', result.stderr);
}

test().catch(console.error);

// Made with Bob
