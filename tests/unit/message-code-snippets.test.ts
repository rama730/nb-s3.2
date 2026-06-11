import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatDraftWithCodeSnippet,
    getCodeSnippetPreview,
    parseMessageSegments,
} from '@/lib/messages/code-snippets';

test('message code snippets keep a fenced code block before a normal caption', () => {
    const content = [
        '```cpp',
        'int main() {',
        '    return 0;',
        '}',
        '```',
        'this is the code',
    ].join('\n');

    const segments = parseMessageSegments(content);

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.type, 'code');
    assert.equal(segments[0]?.language, 'cpp');
    assert.match(segments[0]?.content ?? '', /int main/);
    assert.equal(segments[1]?.type, 'text');
    assert.equal(segments[1]?.content, 'this is the code');
});

test('message code snippets repair reversed code and caption caused by misplaced fences', () => {
    const content = [
        '#include <iostream>',
        'using namespace std;',
        '',
        'int main() {',
        '    return 0;',
        '}',
        '```',
        'this is the code',
        '```',
    ].join('\n');

    const segments = parseMessageSegments(content);

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.type, 'code');
    assert.equal(segments[0]?.language, 'cpp');
    assert.match(segments[0]?.content ?? '', /#include <iostream>/);
    assert.equal(segments[1]?.type, 'text');
    assert.equal(segments[1]?.content, 'this is the code');
});

test('message code snippets repair one-line empty fence artifacts before pasted code', () => {
    const content = [
        '```ts```',
        'ts',
        '#include <iostream>',
        '#include <vector>',
        'using namespace std;',
        '',
        'class Student {',
        'private:',
        '    string name;',
        '};',
    ].join('\n');

    const segments = parseMessageSegments(content);

    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.type, 'code');
    assert.equal(segments[0]?.language, 'cpp');
    assert.match(segments[0]?.content ?? '', /^#include <iostream>/);
    assert.doesNotMatch(segments[0]?.content ?? '', /^ts\n/);
});

test('message code snippets detect C++ classes without include lines', () => {
    const content = [
        'class Student {',
        'private:',
        '    string name;',
        '    int rollNo;',
        '};',
    ].join('\n');

    const segments = parseMessageSegments(content);

    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.type, 'code');
    assert.equal(segments[0]?.language, 'cpp');
});

test('message code snippets do not classify ordinary captions as code', () => {
    const segments = parseMessageSegments('this is the code');

    assert.deepEqual(segments, [{ type: 'text', content: 'this is the code', language: null }]);
    assert.equal(getCodeSnippetPreview('this is the code'), null);
});

test('message code snippet draft formatting preserves code plus text order', () => {
    const content = [
        '```python',
        'def main():',
        '    print("hello")',
        '```',
        'this is the code',
    ].join('\n');

    assert.equal(formatDraftWithCodeSnippet(content), content);
});
