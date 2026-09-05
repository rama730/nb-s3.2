import test from 'node:test';
import assert from 'node:assert/strict';
import { isDisposableEmail, extractEmailDomain } from '@/lib/validations/disposable-email';

test('Disposable Email Validation Suite', async (t) => {
    await t.test('extracts domain accurately from email', () => {
        assert.equal(extractEmailDomain('user@example.com'), 'example.com');
        assert.equal(extractEmailDomain('USER@GMAIL.COM '), 'gmail.com');
        assert.equal(extractEmailDomain('invalid-email'), '');
        assert.equal(extractEmailDomain(''), '');
    });

    await t.test('detects popular disposable domains', () => {
        assert.equal(isDisposableEmail('bot@tempmail.com'), true);
        assert.equal(isDisposableEmail('bot@10minutemail.com'), true);
        assert.equal(isDisposableEmail('test@guerrillamail.com'), true);
        assert.equal(isDisposableEmail('spam@mailinator.com'), true);
        assert.equal(isDisposableEmail('user@trashmail.com'), true);
        assert.equal(isDisposableEmail('random@dispostable.com'), true);
    });

    await t.test('detects subdomains of disposable providers', () => {
        assert.equal(isDisposableEmail('bot@sub.temp-mail.org'), true);
    });

    await t.test('permits legitimate consumer and corporate domains', () => {
        assert.equal(isDisposableEmail('user@gmail.com'), false);
        assert.equal(isDisposableEmail('user@yahoo.com'), false);
        assert.equal(isDisposableEmail('employee@microsoft.com'), false);
        assert.equal(isDisposableEmail('developer@networkbase.in'), false);
        assert.equal(isDisposableEmail('student@mit.edu'), false);
    });
});
