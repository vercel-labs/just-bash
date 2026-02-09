/**
 * Test script to execute the bash command using just-bash
 * This demonstrates piping the excelData.json through the bash command
 */

import { Bash, InMemoryFs } from 'just-bash';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testBashCommand() {
  try {
    // Read the JSON file
    const jsonPath = path.join(__dirname, 'excelData.json');
    const jsonData = fs.readFileSync(jsonPath, 'utf-8');

    console.log('Input JSON size:', jsonData.length, 'bytes');

    // The bash command from the task
    const command = `DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
else
  TOTAL=$(echo "$DATA" | jq '.[0].sheets[0].rows | length')
  COUNT=$((TOTAL - START_IDX))
fi
echo "{\\"h\\": $HEADER_IDX, \\"s\\": $START_IDX, \\"n\\": $COUNT}"`;

    // Create in-memory filesystem
    const memFs = new InMemoryFs();

    // Create Bash instance
    const bash = new Bash({
      fs: memFs,
      cwd: '/',
      env: {
        HOME: '/',
        TMPDIR: '/tmp',
      },
    });

    // Write JSON data to a temp file
    const tempFile = '/tmp/stdin_data';
    await memFs.writeFile(tempFile, jsonData);

    // Execute the command with cat piping the data
    const fullCommand = `cat ${tempFile} | bash -c '${command.replace(/'/g, "'\\''")}'`;

    console.log('\nExecuting command...\n');

    const result = await bash.exec(fullCommand);

    console.log('Exit code:', result.exitCode);
    console.log('\nStdout:');
    console.log(result.stdout);

    if (result.stderr) {
      console.log('\nStderr:');
      console.log(result.stderr);
    }

    // Try to parse the output as JSON
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        console.log('\nParsed output:');
        console.log(JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log('\nCould not parse output as JSON');
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testBashCommand();