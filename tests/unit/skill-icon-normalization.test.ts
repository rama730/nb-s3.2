import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasExplicitCanvasBackground, normalizeTransparentSvg } from '../../scripts/skill-icons/normalize-svg'

describe('skill icon transparent export normalization', () => {
    it('removes a viewBox canvas and preserves internal geometry', () => {
        const input = '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="#01A88D"/><path width="9" height="7" fill="#fff" d="M6 6h28v28H6z"/></svg>\n'
        const result = normalizeTransparentSvg(input)

        assert.equal(result.removedCanvas, true)
        assert.equal(result.extractedBrandColor, '#01A88D')
        assert.doesNotMatch(result.svg, /<rect width="40" height="40"/)
        assert.match(result.svg, /width="9" height="7"/)
        assert.match(result.svg, /fill="#01A88D"/)
        assert.equal(hasExplicitCanvasBackground(result.svg), false)
    })

    it('moves a full-canvas gradient onto the service glyph', () => {
        const input = '<svg viewBox="0 0 256 256"><defs><linearGradient id="brand"><stop stop-color="#527fff"/></linearGradient></defs><path fill="url(#brand)" d="M0 0h256v256H0z"/><path fill="#fff" d="M64 64h128v128H64z"/></svg>\n'
        const result = normalizeTransparentSvg(input)

        assert.equal(result.removedCanvas, true)
        assert.match(result.svg, /<path fill="url\(#brand\)" d="M64 64h128v128H64z"/)
        assert.equal(hasExplicitCanvasBackground(result.svg), false)
    })

    it('supports reviewed rounded-tile assets without deleting the mark', () => {
        const input = '<svg viewBox="0 0 256 250"><path fill="#00005b" d="M45 0h166c25 0 45 20 45 45v160c0 25-20 45-45 45H45C20 250 0 230 0 205V45C0 20 20 0 45 0"/><path fill="#99f" d="M60 65h136v111H60z"/></svg>\n'
        const result = normalizeTransparentSvg(input, { removeFirstShape: true })

        assert.equal(result.removedCanvas, true)
        assert.doesNotMatch(result.svg, /fill="#00005b"/)
        assert.match(result.svg, /fill="#99f"/)
    })

    it('never removes full-canvas geometry from clipping definitions', () => {
        const input = '<svg viewBox="0 0 182 182"><defs><clipPath id="clip"><rect width="182" height="182" fill="none"/></clipPath></defs><g clip-path="url(#clip)"><path fill="#ff6310" d="M20 20h142v142H20z"/></g></svg>\n'
        const result = normalizeTransparentSvg(input)

        assert.equal(result.removedCanvas, false)
        assert.match(result.svg, /<rect width="182" height="182" fill="none"\/>/)
        assert.match(result.svg, /clip-path="url\(#clip\)"/)
        assert.equal(hasExplicitCanvasBackground(result.svg), false)
    })
})
