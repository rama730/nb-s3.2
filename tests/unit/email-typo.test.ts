import assert from 'node:assert/strict'
import test from 'node:test'
import { detectEmailDomainTypo } from '@/lib/validations/email-typo'

test('detectEmailDomainTypo detects common Gmail typos', () => {
    assert.deepEqual(detectEmailDomainTypo('alex@gmai.com'), {
        hasTypo: true,
        suggestedEmail: 'alex@gmail.com',
        correctedDomain: 'gmail.com',
    })

    assert.deepEqual(detectEmailDomainTypo('user@gamil.com'), {
        hasTypo: true,
        suggestedEmail: 'user@gmail.com',
        correctedDomain: 'gmail.com',
    })

    assert.deepEqual(detectEmailDomainTypo('test@gmail.co'), {
        hasTypo: true,
        suggestedEmail: 'test@gmail.com',
        correctedDomain: 'gmail.com',
    })
})

test('detectEmailDomainTypo detects Yahoo, Hotmail, and Outlook typos', () => {
    assert.deepEqual(detectEmailDomainTypo('person@yaho.com'), {
        hasTypo: true,
        suggestedEmail: 'person@yahoo.com',
        correctedDomain: 'yahoo.com',
    })

    assert.deepEqual(detectEmailDomainTypo('contact@hotmial.com'), {
        hasTypo: true,
        suggestedEmail: 'contact@hotmail.com',
        correctedDomain: 'hotmail.com',
    })

    assert.deepEqual(detectEmailDomainTypo('dev@outlok.com'), {
        hasTypo: true,
        suggestedEmail: 'dev@outlook.com',
        correctedDomain: 'outlook.com',
    })
})

test('detectEmailDomainTypo ignores valid popular and custom corporate domains', () => {
    assert.equal(detectEmailDomainTypo('alex@gmail.com').hasTypo, false)
    assert.equal(detectEmailDomainTypo('alex@yahoo.com').hasTypo, false)
    assert.equal(detectEmailDomainTypo('alex@company.org').hasTypo, false)
    assert.equal(detectEmailDomainTypo('developer@stripe.com').hasTypo, false)
    assert.equal(detectEmailDomainTypo('invalid-email').hasTypo, false)
})
