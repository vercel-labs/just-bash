/**
 * Test for jq command with budget file data
 * This test demonstrates an issue where jq filtering returns empty results
 */

import { describe, it, expect } from 'vitest';
import { Bash } from './Bash';
import { InMemoryFs } from './fs/in-memory-fs';

describe('jq with budget file', () => {
  it('should find EXPENSES rows using jq filter', async () => {
    // Create a simplified budget structure
    const budgetData = [
      {
        excelData: {
          sheets: [
            {
              name: 'Budget Overview',
              rows: [
                ['INCOME', '', '', ''],
                ['Source', 'Jan', 'Feb', 'TOTAL'],
                ['Salary', 5200, 5200, 10400],
                ['TOTAL INCOME', 5200, 5200, 10400],
                ['', '', '', ''],
                ['EXPENSES', '', '', ''],
                ['Source', 'Jan', 'Feb', 'TOTAL'],
                ['Rent', 1800, 1800, 3600],
                ['TOTAL EXPENSES', 1800, 1800, 3600],
              ],
            },
          ],
        },
        availableSheets: [
          {
            index: 0,
            name: 'Budget Overview',
            rowCount: 9,
          },
        ],
      },
    ];

    const fs = new InMemoryFs();
    const bash = new Bash({ fs });

    // Write the budget data to a file
    await bash.exec(
      `echo '${JSON.stringify(budgetData)}' > /budgetFile.json`,
    );

    // First, verify the file was created and contains data
    const catResult = await bash.exec('cat /budgetFile.json');
    expect(catResult.stdout).toContain('EXPENSES');
    expect(catResult.stdout).toContain('TOTAL EXPENSES');

    // Test 1: Simple jq to get a specific row (this should work)
    const simpleJqResult = await bash.exec(
      'cat /budgetFile.json | jq ".[0].excelData.sheets[0].rows[5]"',
    );
    console.log('Simple jq result:', simpleJqResult.stdout);
    expect(simpleJqResult.stdout).toContain('EXPENSES');

    // Test 2: Complex jq filter to find EXPENSES rows
    // This is the command that returns empty in the collie-poc tests
    const complexJqResult = await bash.exec(
      'cat /budgetFile.json | jq \'.[0].excelData.sheets[0].rows | to_entries | .[] | select(.value[0] == "EXPENSES" or .value[0] == "TOTAL EXPENSES") | {index: .key, firstColumn: .value[0]}\'',
    );

    console.log('Complex jq stdout:', complexJqResult.stdout);
    console.log('Complex jq stderr:', complexJqResult.stderr);
    console.log('Complex jq exitCode:', complexJqResult.exitCode);

    // Expected output should contain both EXPENSES entries
    expect(complexJqResult.stdout).toContain('"firstColumn": "EXPENSES"');
    expect(complexJqResult.stdout).toContain('"firstColumn": "TOTAL EXPENSES"');
    expect(complexJqResult.stdout).toContain('"index": 5');
    expect(complexJqResult.stdout).toContain('"index": 8');
  });

  it('should test jq availability and version', async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs });

    // Check if jq command exists
    const whichResult = await bash.exec('which jq');
    console.log('which jq:', whichResult.stdout, whichResult.stderr);

    // Try to get jq version
    const versionResult = await bash.exec('jq --version');
    console.log('jq version:', versionResult.stdout, versionResult.stderr);
  });

  it('should test basic jq functionality', async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs });

    // Create a simple JSON file
    await bash.exec('echo \'{"name": "test", "value": 123}\' > /test.json');

    // Test basic jq
    const result = await bash.exec('cat /test.json | jq ".name"');
    console.log('Basic jq result:', result.stdout, result.stderr);
    expect(result.stdout.trim()).toBe('"test"');
  });

  it('should test jq with array filtering', async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs });

    // Create an array JSON file
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Charlie', age: 35 },
    ];

    await bash.exec(`echo '${JSON.stringify(data)}' > /users.json`);

    // Test array filtering
    const result = await bash.exec(
      'cat /users.json | jq ".[] | select(.age > 30)"',
    );
    console.log('Array filter result:', result.stdout, result.stderr);
    expect(result.stdout).toContain('Charlie');
    expect(result.stdout).not.toContain('Alice');
    expect(result.stdout).not.toContain('Bob');
  });
});