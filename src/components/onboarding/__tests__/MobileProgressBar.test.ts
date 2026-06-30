import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'

function stepLabel(currentStep: number, totalSteps: number) {
  return `Step ${currentStep} of ${totalSteps}`
}

describe('MobileProgressBar explicit progress', () => {
  it('always identifies the current step', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 10 }).chain((totalSteps) => fc.record({
        currentStep: fc.integer({ min: 1, max: totalSteps }),
        totalSteps: fc.constant(totalSteps),
      })),
      ({ currentStep, totalSteps }) => {
        assert.equal(stepLabel(currentStep, totalSteps), `Step ${currentStep} of ${totalSteps}`)
      },
    ))
  })
})

const source = readFileSync(path.resolve(__dirname, '../MobileProgressBar.tsx'), 'utf8')

describe('MobileProgressBar visual and accessibility contract', () => {
  it('renders Step X of Y instead of an ambiguous percentage', () => {
    assert.match(source, /Step \{currentStep\} of \{totalSteps\}/)
    assert.doesNotMatch(source, /completionPercentage/)
  })

  it('uses committed progress for progressbar semantics', () => {
    assert.match(source, /role="progressbar"/)
    assert.match(source, /aria-valuenow=\{completedThrough\}/)
  })

  it('keeps the active number visible until acknowledgement', () => {
    assert.match(source, /isCurrent\s*&&\s*!showAcknowledgedCheck/)
    assert.match(source, /\{step\}/)
  })
})
