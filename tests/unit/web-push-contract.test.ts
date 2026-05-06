import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('web push delivery records preserve non-Error throw messages', () => {
    const source = readProjectFile('src/lib/notifications/web-push.ts');

    assert.match(source, /const normalizedErrorMessage = error instanceof Error \? error\.message : String\(error\)/);
    assert.match(source, /const errorMessage = normalizedErrorMessage\.trim\(\)\.slice\(0, 500\) \|\| null/);
    assert.match(source, /error:\s*normalizedErrorMessage/);
    assert.match(source, /errorMessage,\s*\n\s*\}\)/);
    assert.doesNotMatch(source, /\(error as Error\)\.message\?\.slice\(0, 500\) \?\? null/);
});
