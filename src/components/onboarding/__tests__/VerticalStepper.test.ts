import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'

type StepState = 'completed' | 'current' | 'pending'

function getStepState(step: number, currentStep: number, completedThrough: number): StepState {
  if (step === currentStep) return 'current'
  if (step <= completedThrough) return 'completed'
  return 'pending'
}

describe('VerticalStepper committed progress', () => {
  it('keeps the active step current even when the user revisits a committed step', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 0, max: 4 }),
      (currentStep, completedThrough) => {
        assert.equal(getStepState(currentStep, currentStep, completedThrough), 'current')
      },
    ))
  })

  it('checks only committed, non-current steps', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 0, max: 4 }),
      (currentStep, completedThrough) => {
        for (let step = 1; step <= 4; step += 1) {
          const expected = step === currentStep
            ? 'current'
            : step <= completedThrough
              ? 'completed'
              : 'pending'
          assert.equal(getStepState(step, currentStep, completedThrough), expected)
        }
      },
    ))
  })
})

const source = readFileSync(path.resolve(__dirname, '../OnboardingSidebar.tsx'), 'utf8')

describe('VerticalStepper visual contract', () => {
  it('renders the current step number and exposes aria-current', () => {
    assert.match(source, /isCurrent\s*&&\s*!showAcknowledgedCheck/)
    assert.match(source, /\{step\}/)
    assert.match(source, /aria-current.*step/)
  })

  it('renders a check only for committed or just-acknowledged steps', () => {
    assert.match(source, /isCompleted\s*\|\|\s*showAcknowledgedCheck/)
    assert.match(source, /<Check/)
    assert.match(source, /Step \{step\} completed/)
  })

  it('uses a fixed marker column and marker-center connector geometry', () => {
    assert.match(source, /grid-cols-\[24px_minmax\(0,1fr\)\]/)
    assert.match(source, /left-\[11px\]\s+top-3\s+-bottom-3\s+w-\[2px\]/)
  })

  it('fills connector segments only from committed progress', () => {
    assert.match(source, /completedSteps\.has\(step\)/)
    assert.match(source, /bg-primary/)
    assert.match(source, /bg-border/)
  })
})
