import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillIcon } from '../../../src/components/skills/SkillIcon'
import { resolveClientSkill } from '../../../src/lib/skills/client'

function render(name: string, colorMode: 'brand' | 'current' = 'brand') {
    return renderToStaticMarkup(createElement(SkillIcon, {
        skill: resolveClientSkill(name),
        colorMode,
        decorative: false,
    }))
}

describe('skill icon theme policy', () => {
    it('renders reviewed monochrome pairs explicitly in both themes', () => {
        const anthropic = render('Anthropic API')

        assert.match(anthropic, /dark:hidden/)
        assert.match(anthropic, /hidden dark:block/)
        assert.match(anthropic, /style="fill:#181818"/)
        assert.match(anthropic, /style="fill:#FFFFFF"/i)
        assert.match(anthropic, /skill-logos-anthropic-icon/)
    })

    it('never adds theme variants to stable multicolor brand assets', () => {
        for (const name of ['SolidJS', 'MATLAB', 'PowerShell', 'Codex']) {
            const markup = render(name)
            assert.match(markup, /skill-sprites\.svg(?:\?\S+)?#skill-/, name)
            assert.doesNotMatch(markup, /dark:hidden|dark:block/, name)
        }
    })

    it('keeps Safari-unsafe custom SVG gradients out of the external sprite path', () => {
        const markup = render('Google Antigravity')

        assert.match(markup, /\/skill-icons\/v1\/curated-google-antigravity\.svg/)
        assert.doesNotMatch(markup, /skill-sprites\.svg/)
        assert.doesNotMatch(markup, /dark:hidden|dark:block/)
    })

    it('uses an explicit inverse only for reviewed dark-colliding monochrome marks', () => {
        const github = render('GitHub')

        assert.match(github, /style="fill:#181717"/)
        assert.match(github, /style="fill:#FFFFFF"/i)
        assert.match(github, /hidden dark:block/)
        assert.match(github, /skill-github/)
    })

    it('switches to upstream light and dark assets when the source publishes a pair', () => {
        const next = render('Next.js')

        assert.match(next, /skill-skill-icons-nextjs-light/)
        assert.match(next, /skill-skill-icons-nextjs-dark/)
        assert.match(next, /dark:hidden/)
        assert.match(next, /hidden dark:block/)
    })

    it('uses current color without a brand theme pair when requested', () => {
        const anthropic = render('Anthropic API', 'current')

        assert.match(anthropic, /skill-logos-anthropic-icon/)
        assert.doesNotMatch(anthropic, /dark:hidden|dark:block/)
        assert.match(anthropic, /style="fill:currentColor"/)
    })

    it('uses a semantic theme-readable glyph for WebSockets', () => {
        const websockets = render('WebSockets')

        assert.match(websockets, /<svg/)
        assert.match(websockets, /aria-label="WebSockets"/)
        assert.match(websockets, /skill-lucide-/)
    })
})
