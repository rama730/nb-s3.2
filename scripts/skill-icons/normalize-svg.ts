type ViewBox = {
    minX: number
    minY: number
    width: number
    height: number
}

export type TransparentSvgResult = {
    svg: string
    removedCanvas: boolean
    extractedBrandColor: string | null
}

function attribute(attributes: string, name: string): string | null {
    const match = attributes.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
    return match?.[1] ?? match?.[2] ?? null
}

function numericAttribute(attributes: string, name: string, fallback: number): number {
    const value = attribute(attributes, name)
    if (value == null) return fallback
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
}

function parseViewBox(svg: string): ViewBox | null {
    const value = svg.match(/<svg\b[^>]*\sviewBox\s*=\s*(?:"([^"]+)"|'([^']+)')/i)?.slice(1).find(Boolean)
    if (!value) return null
    const values = value.trim().split(/[\s,]+/).map(Number)
    if (values.length !== 4 || values.some((entry) => !Number.isFinite(entry))) return null
    const [minX = 0, minY = 0, width = 0, height = 0] = values
    return width > 0 && height > 0 ? { minX, minY, width, height } : null
}

function approximately(left: number, right: number): boolean {
    // Icon packs commonly round a 250-unit canvas to 249.6. Treat sub-pixel
    // and <=0.5% differences as the same full canvas, but not content panels.
    return Math.abs(left - right) <= Math.max(1, Math.abs(right) * 0.005)
}

function isFullCanvasRect(attributes: string, viewBox: ViewBox): boolean {
    const x = numericAttribute(attributes, 'x', 0)
    const y = numericAttribute(attributes, 'y', 0)
    const width = numericAttribute(attributes, 'width', Number.NaN)
    const height = numericAttribute(attributes, 'height', Number.NaN)
    return approximately(x, viewBox.minX)
        && approximately(y, viewBox.minY)
        && approximately(width, viewBox.width)
        && approximately(height, viewBox.height)
}

function escapedNumber(value: number): string {
    const text = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `${text}(?:\\.0+)?`
}

function isFullCanvasPath(attributes: string, viewBox: ViewBox): boolean {
    if (viewBox.minX !== 0 || viewBox.minY !== 0) return false
    const d = attribute(attributes, 'd')?.trim()
    if (!d) return false
    const width = escapedNumber(viewBox.width)
    const height = escapedNumber(viewBox.height)
    const patterns = [
        new RegExp(`^M\\s*0[\\s,]+0\\s*[hH]\\s*${width}\\s*[vV]\\s*${height}\\s*[hH]\\s*-${width}\\s*[zZ]$`),
        new RegExp(`^M\\s*0[\\s,]+0\\s*[hH]\\s*${width}\\s*[vV]\\s*${height}\\s*H\\s*0\\s*[zZ]$`),
        new RegExp(`^M\\s*0[\\s,]+0\\s*H\\s*${width}\\s*V\\s*${height}\\s*H\\s*0\\s*[zZ]$`),
        new RegExp(`^M\\s*0[\\s,]+0\\s*[vV]\\s*${height}\\s*[hH]\\s*${width}\\s*V\\s*0\\s*[zZ]$`),
    ]
    return patterns.some((pattern) => pattern.test(d))
}

function paint(attributes: string): string | null {
    return attribute(attributes, 'fill') ?? attribute(attributes, 'color')
}

function solidColor(value: string | null): string | null {
    if (!value) return null
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        const [, red = '', green = '', blue = ''] = value
        return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase()
    }
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null
}

function isLightColor(value: string | null): boolean {
    const color = solidColor(value)
    if (!color) return false
    const red = Number.parseInt(color.slice(1, 3), 16)
    const green = Number.parseInt(color.slice(3, 5), 16)
    const blue = Number.parseInt(color.slice(5, 7), 16)
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue) >= 225
}

function hasSupportedShape(svg: string): boolean {
    return /<(path|polygon|polyline|circle|rect|ellipse)\b/i.test(svg)
}

function recolorWhiteForeground(svg: string, backgroundPaint: string | null): string {
    if (!backgroundPaint || isLightColor(backgroundPaint)) return svg
    return svg.replace(/\sfill\s*=\s*(?:"(?:#fff(?:fff)?|white)"|'(?:#fff(?:fff)?|white)')/gi, ` fill="${backgroundPaint}"`)
}

/**
 * Removes decorative, viewBox-sized canvas layers while preserving the actual
 * product/service mark. When an upstream architecture icon uses a white mark
 * over a brand-colored tile, the mark inherits that extracted brand paint.
 */
export function normalizeTransparentSvg(
    svg: string,
    options: { removeFirstShape?: boolean; skipRecolor?: boolean } = {},
): TransparentSvgResult {
    const viewBox = parseViewBox(svg)
    if (!viewBox) return { svg, removedCanvas: false, extractedBrandColor: null }

    const original = svg
    const protectedDefinitions: string[] = []
    // Definition geometry is not painted directly. In particular, a
    // viewBox-sized rect inside a clipPath is a clipping region, not a canvas.
    // Removing it creates a syntactically valid but completely empty icon.
    let normalized = svg.replace(/<defs\b[\s\S]*?<\/defs>/gi, (definitions) => {
        const token = `__NB_SKILL_ICON_DEFS_${protectedDefinitions.length}__`
        protectedDefinitions.push(definitions)
        return token
    })
    let removedCanvas = false
    let backgroundPaint: string | null = null

    normalized = normalized.replace(/<g\b([^>]*)>\s*(<rect\b([^>]*)\/?\s*>\s*(?:<\/rect>)?)\s*<\/g>/gi, (group, groupAttributes: string, _rect, rectAttributes: string) => {
        if (!isFullCanvasRect(rectAttributes, viewBox)) return group
        backgroundPaint ??= paint(rectAttributes) ?? paint(groupAttributes)
        removedCanvas = true
        return ''
    })

    normalized = normalized.replace(/<rect\b([^>]*)\/?\s*>\s*(?:<\/rect>)?/gi, (rect, attributes: string) => {
        if (!isFullCanvasRect(attributes, viewBox)) return rect
        backgroundPaint ??= paint(attributes)
        removedCanvas = true
        return ''
    })

    normalized = normalized.replace(/<path\b([^>]*)\/?\s*>\s*(?:<\/path>)?/gi, (path, attributes: string) => {
        if (!isFullCanvasPath(attributes, viewBox)) return path
        backgroundPaint ??= paint(attributes)
        removedCanvas = true
        return ''
    })

    if (options.removeFirstShape && !removedCanvas) {
        let removed = false
        normalized = normalized.replace(/<(path|polygon|polyline|circle|rect|ellipse)\b([^>]*)\/?\s*>\s*(?:<\/\1>)?/i, (shape, _tag: string, attributes: string) => {
            if (removed) return shape
            removed = true
            backgroundPaint ??= paint(attributes)
            removedCanvas = true
            return ''
        })
    }

    if (!removedCanvas || !hasSupportedShape(normalized)) {
        return { svg: original, removedCanvas: false, extractedBrandColor: null }
    }

    normalized = normalized.replace(/__NB_SKILL_ICON_DEFS_(\d+)__/g, (_token, index: string) => (
        protectedDefinitions[Number(index)] ?? ''
    ))
    normalized = options.skipRecolor ? normalized : recolorWhiteForeground(normalized, backgroundPaint)
    return {
        svg: normalized,
        removedCanvas: true,
        extractedBrandColor: solidColor(backgroundPaint),
    }
}

export function hasExplicitCanvasBackground(svg: string): boolean {
    const viewBox = parseViewBox(svg)
    if (!viewBox) return false
    // Definitions describe masks, clips, and gradients; they are not painted.
    // Inspecting them as visible content falsely rejects valid icon geometry.
    const paintedMarkup = svg.replace(/<defs\b[\s\S]*?<\/defs>/gi, '')
    if ([...paintedMarkup.matchAll(/<rect\b([^>]*)\/?\s*>/gi)].some((match) => isFullCanvasRect(match[1] ?? '', viewBox))) return true
    return [...paintedMarkup.matchAll(/<path\b([^>]*)\/?\s*>/gi)].some((match) => isFullCanvasPath(match[1] ?? '', viewBox))
}
