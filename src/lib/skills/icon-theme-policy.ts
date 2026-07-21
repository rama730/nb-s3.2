export type SkillIconThemeVariant = {
    lightColor: string
    darkColor: string
    rationale: 'official-monochrome-pair' | 'reviewed-monochrome-inverse'
}

const REVIEWED_SIMPLE_ICON_DARK_INVERSES = new Set<string>([
    'actix', 'ada', 'alchemy', 'almalinux', 'angular', 'apachekafka', 'basecamp',
    'bentoml', 'bevy', 'buffer', 'bun', 'cinema4d', 'cline', 'clion',
    'coffeescript', 'commonlisp', 'confluence', 'crystal', 'cursor', 'datagrip',
    'dbeaver', 'deno', 'django', 'elevenlabs', 'expo', 'express', 'fastify',
    'flydotio', 'gamemaker', 'github', 'githubcopilot', 'gradle', 'harmonyos',
    'helm', 'intellijidea', 'ios', 'koa', 'less', 'lua', 'lucid', 'mapbox',
    'markdown', 'mariadb', 'micropython', 'miro', 'modelcontextprotocol',
    'near', 'nextdotjs', 'notion', 'ollama', 'opencode', 'opentelemetry',
    'opsgenie', 'owasp', 'pandas', 'phpstorm', 'planetscale', 'posthog',
    'prefect', 'pycharm', 'railway', 'remix', 'render', 'replicate',
    'rider', 'rive', 'robotframework', 'rust', 'sanity', 'shadcnui', 'splunk',
    'stmicroelectronics', 'swr', 'symfony', 'threedotjs', 'ultralytics',
    'unrealengine', 'v0', 'vercel', 'webstorm', 'windsurf', 'braintrust',
    'lmstudio', 'moonshotai', 'notebooklm', 'langflow', 'cryengine',
] as const)

/**
 * Theme adaptation is deliberately opt-in. Most brand assets keep their
 * original pixels in every theme. Only marks with a reviewed monochrome
 * light/dark treatment belong here.
 */
export const SKILL_ICON_THEME_VARIANTS: Readonly<Record<string, SkillIconThemeVariant>> = {
    apple: { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'devicon-apple': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'logos-apple': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'logos-macos': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'logos-anthropic-icon': { lightColor: '#181818', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'logos-openai-icon': { lightColor: '#111111', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'devicon-cobol': { lightColor: '#005CA5', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'devicon-codepen': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'logos-ibm': { lightColor: '#052FAD', darkColor: '#FFFFFF', rationale: 'official-monochrome-pair' },
    'logos-midjourney': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'logos-pinecone-icon': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'logos-pipedrive': { lightColor: '#231F1F', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-apache-iceberg': { lightColor: '#4B8BBE', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-autogen': { lightColor: '#2D2D2F', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-baseten': { lightColor: '#111111', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-dagster': { lightColor: '#654FF0', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-llamaindex': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-openxr': { lightColor: '#000000', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-phaser': { lightColor: '#8A57A8', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-promptfoo': { lightColor: '#E33A2C', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-ragas': { lightColor: '#7C3AED', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-roo-code': { lightColor: '#6B57FF', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
    'curated-zephyr': { lightColor: '#6C4C9F', darkColor: '#FFFFFF', rationale: 'reviewed-monochrome-inverse' },
}

export function resolveSkillIconThemeVariant(input: {
    iconSource: string
    iconKey: string
    brandColor?: string | null
}): SkillIconThemeVariant | undefined {
    const exact = SKILL_ICON_THEME_VARIANTS[input.iconKey]
    if (exact) return exact
    if (input.iconSource !== 'simple-icons' || !REVIEWED_SIMPLE_ICON_DARK_INVERSES.has(input.iconKey)) {
        return undefined
    }
    return {
        lightColor: input.brandColor ?? '#111111',
        darkColor: '#FFFFFF',
        rationale: 'reviewed-monochrome-inverse',
    }
}

/**
 * Concepts and protocols in this list intentionally use a semantic glyph.
 * They must not be replaced by a low-contrast pseudo-brand asset.
 */
export const SKILL_SEMANTIC_ICON_ONLY = new Set(['WebSockets'])
