import test from 'node:test';
import assert from 'node:assert/strict';
import { isApplicationReviewerRole } from '@/lib/applications/authorization';

test('application reviewer role matrix', () => {
    assert.equal(isApplicationReviewerRole('owner'), true);
    assert.equal(isApplicationReviewerRole('admin'), true);
    assert.equal(isApplicationReviewerRole('Owner'), true);
    assert.equal(isApplicationReviewerRole(' member '), false);
    assert.equal(isApplicationReviewerRole('viewer'), false);
    assert.equal(isApplicationReviewerRole('lead'), false);
    assert.equal(isApplicationReviewerRole('manager'), false);
    assert.equal(isApplicationReviewerRole(undefined), false);
    assert.equal(isApplicationReviewerRole(null), false);
});
