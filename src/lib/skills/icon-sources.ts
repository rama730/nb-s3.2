export type AuditedIconSourceId =
    | 'simple-icons'
    | 'devicon'
    | 'skill-icons'
    | 'iconic'
    | 'profile-technology-icons'
    | 'logos'
    | 'geticon'
    | 'developer-icons'
    | 'thesvg'

export type AuditedIconSource = {
    id: AuditedIconSourceId
    repository: string
    auditedCommit: string
    license: string | null
    assetCount: number
    integration: 'package' | 'vendored' | 'discovery-only'
    packageName?: string
    packageVersion?: string
    note: string
}

export const SKILL_ICON_SOURCE_REGISTRY: readonly AuditedIconSource[] = [
    {
        id: 'simple-icons', repository: 'https://github.com/simple-icons/simple-icons',
        auditedCommit: '99fbe6a82b31d49a37fee878d5fc4f37a53df155', license: 'CC0-1.0', assetCount: 3446,
        integration: 'package', packageName: 'simple-icons', packageVersion: '16.24.1',
        note: 'Primary monochrome brand source with upstream provenance and brand color metadata.',
    },
    {
        id: 'devicon', repository: 'https://github.com/devicons/devicon',
        auditedCommit: '7330accdbc47e2dc0c19789a48533c4a3c50fe58', license: 'MIT', assetCount: 1913,
        integration: 'package', packageName: 'devicon', packageVersion: '2.17.0',
        note: 'Primary multivariant development technology source.',
    },
    {
        id: 'skill-icons', repository: 'https://github.com/tandpfun/skill-icons',
        auditedCommit: '7f7e691e71aec64e8354bf697835e009d1ad80f8', license: 'MIT', assetCount: 406,
        integration: 'package', packageName: '@iconify-json/skill-icons', packageVersion: '1.2.4',
        note: 'Technology-focused fallback consumed from the pinned Iconify mirror.',
    },
    {
        id: 'iconic', repository: 'https://github.com/YuheshPandian/ICONIC',
        auditedCommit: 'dcb8107fd7f903b9f9922e09695c22452a8d360c', license: 'MIT', assetCount: 481,
        integration: 'vendored',
        note: 'Selected missing product marks are vendored from the audited commit; overlapping assets resolve through pinned package sources.',
    },
    {
        id: 'profile-technology-icons', repository: 'https://github.com/marwin1991/profile-technology-icons',
        auditedCommit: '767ebf36092606430fc527b132babacb060dec81', license: null, assetCount: 266,
        integration: 'discovery-only',
        note: 'Name inventory only because the repository does not declare a license.',
    },
    {
        id: 'logos', repository: 'https://github.com/gilbarbara/logos',
        auditedCommit: '42037415f0df19cd82b3853c18a967a81783f921', license: 'CC0-1.0', assetCount: 1863,
        integration: 'package', packageName: '@iconify-json/logos', packageVersion: '1.2.11',
        note: 'Broad multicolor product-logo fallback consumed from the pinned Iconify mirror.',
    },
    {
        id: 'geticon', repository: 'https://github.com/get-icon/geticon',
        auditedCommit: 'fc0f660daee147afb4a56c64e12bde6486b73e39', license: 'CC0-1.0', assetCount: 1560,
        integration: 'vendored',
        note: 'Selected missing technology marks are vendored from the audited commit; overlapping artwork resolves through the pinned logos source.',
    },
    {
        id: 'developer-icons', repository: 'https://github.com/xandemon/developer-icons',
        auditedCommit: 'ac6e9bcc5ad73692cd5637f3bd98c2fe83adadae', license: 'MIT', assetCount: 329,
        integration: 'package', packageName: 'developer-icons', packageVersion: '7.0.1',
        note: 'Current developer and AI product logos rendered to static local SVG during generation.',
    },
    {
        id: 'thesvg', repository: 'https://github.com/glincker/thesvg',
        auditedCommit: 'e25d9e9c43c40f353a5b1c109c9d288d8a4fa16b', license: 'MIT', assetCount: 12300,
        integration: 'vendored',
        note: 'Selected current product marks are vendored from the audited commit; generic UI artwork remains excluded from skill identity.',
    },
] as const

export const SKILL_ICONIFY_OVERRIDES: Readonly<Record<string, { source: 'skill-icons' | 'logos'; key: string }>> = {
    'Next.js': { source: 'skill-icons', key: 'nextjs-light' },
    'Ableton Live': { source: 'skill-icons', key: 'ableton-light' },
    'Adobe Illustrator': { source: 'logos', key: 'adobe-illustrator' },
    'Adobe After Effects': { source: 'logos', key: 'adobe-after-effects' },
    'Adobe Photoshop': { source: 'logos', key: 'adobe-photoshop' },
    'Adobe Premiere Pro': { source: 'logos', key: 'adobe-premiere' },
    'Adobe XD': { source: 'logos', key: 'adobe-xd' },
    'Adobe Express': { source: 'logos', key: 'adobe-icon' },
    'Adobe Commerce': { source: 'logos', key: 'magento' },
    'Amazon DynamoDB': { source: 'skill-icons', key: 'dynamodb-light' },
    'Red Hat Enterprise Linux': { source: 'skill-icons', key: 'redhat-light' },
    'Plan 9': { source: 'skill-icons', key: 'plan9-light' },
    'Microsoft Power BI': { source: 'logos', key: 'microsoft-power-bi' },
    'OpenAI API': { source: 'logos', key: 'openai-icon' },
    'Claude': { source: 'logos', key: 'anthropic-icon' },
    'Gemini': { source: 'logos', key: 'google-gemini' },
    'Web Components': { source: 'logos', key: 'webcomponents' },
    'WebSockets': { source: 'logos', key: 'websocket' },
    'OAuth 2.0': { source: 'logos', key: 'oauth' },
    'JSON:API': { source: 'logos', key: 'json' },
    'Apollo Client': { source: 'skill-icons', key: 'apollo' },
    'Spring Framework': { source: 'logos', key: 'spring-icon' },
    'Amazon Aurora': { source: 'logos', key: 'aws-aurora' },
    'Amazon Redshift': { source: 'logos', key: 'aws-redshift' },
    'Amazon RDS': { source: 'logos', key: 'aws-rds' },
    'AWS Lambda': { source: 'logos', key: 'aws-lambda' },
    'Amazon Web Services': { source: 'skill-icons', key: 'aws-light' },
    'IBM Db2': { source: 'logos', key: 'ibm' },
    'Firebase Hosting': { source: 'logos', key: 'firebase-icon' },
    'IBM Cloud': { source: 'logos', key: 'ibm' },
    'Yarn Berry': { source: 'logos', key: 'yarn' },
    'NVIDIA Jetson': { source: 'logos', key: 'nvidia' },
    'Monday.com': { source: 'logos', key: 'monday-icon' },
    'Oracle ERP': { source: 'logos', key: 'oracle' },
    'Zoho CRM': { source: 'logos', key: 'zoho' },
    'Customer.io': { source: 'logos', key: 'customerio-icon' },
    'App Store Connect': { source: 'logos', key: 'apple-app-store' },
    'Android Jetpack': { source: 'logos', key: 'android-icon' },
    'Compose Multiplatform': { source: 'logos', key: 'kotlin-icon' },
    'MapKit': { source: 'logos', key: 'apple' },
    'HealthKit': { source: 'logos', key: 'apple' },
    'StoreKit': { source: 'logos', key: 'apple' },
    'Core ML': { source: 'logos', key: 'apple' },
    'CarPlay': { source: 'logos', key: 'apple' },
    'Swift Package Manager': { source: 'logos', key: 'swift' },
    'Firebase App Distribution': { source: 'logos', key: 'firebase-icon' },
    'Android NDK': { source: 'logos', key: 'android-icon' },
    'Android TV': { source: 'logos', key: 'android-icon' },
    'FlutterFlow': { source: 'logos', key: 'flutter' },
    'Realm': { source: 'logos', key: 'realm' },
    'Material 3': { source: 'logos', key: 'material-ui' },
    'OpenAI Agents SDK': { source: 'logos', key: 'openai-icon' },
    'Google Agent Development Kit': { source: 'logos', key: 'google-gemini' },
    'Azure AI Foundry': { source: 'logos', key: 'microsoft-azure' },
    'Google AI Studio': { source: 'logos', key: 'google-gemini' },
    'Snowflake Cortex AI': { source: 'logos', key: 'snowflake-icon' },
    'IBM watsonx': { source: 'logos', key: 'ibm' },
    'Cloudflare Workers AI': { source: 'logos', key: 'cloudflare-workers-icon' },
    'NVIDIA NIM': { source: 'logos', key: 'nvidia' },
    'NVIDIA NeMo': { source: 'logos', key: 'nvidia' },
    'Amazon SageMaker AI': { source: 'logos', key: 'aws' },
    'Azure Machine Learning': { source: 'logos', key: 'microsoft-azure' },
    'Google Vertex AI Agent Engine': { source: 'logos', key: 'google-gemini' },
    'Vercel AI SDK': { source: 'skill-icons', key: 'vercel-light' },
    'Google Genkit': { source: 'logos', key: 'google-icon' },
    'Microsoft Agent Framework': { source: 'logos', key: 'microsoft-icon' },
    'OpenAI Swarm': { source: 'logos', key: 'openai-icon' },
    smolagents: { source: 'logos', key: 'hugging-face-icon' },
    'OpenAI Evals': { source: 'logos', key: 'openai-icon' },
    'Text Generation Inference': { source: 'logos', key: 'hugging-face-icon' },
    'TensorRT': { source: 'logos', key: 'nvidia' },
    'Midjourney': { source: 'logos', key: 'midjourney' },
    'Replit Agent': { source: 'logos', key: 'replit-icon' },
    'JetBrains AI Assistant': { source: 'logos', key: 'jetbrains-icon' },
    'Qwen Code': { source: 'logos', key: 'qwen-icon' },
    'Linux': { source: 'skill-icons', key: 'linux-light' },
    'macOS': { source: 'logos', key: 'macos' },
    'iPadOS': { source: 'logos', key: 'apple' },
    'watchOS': { source: 'logos', key: 'apple' },
    'tvOS': { source: 'logos', key: 'apple' },
    'visionOS': { source: 'logos', key: 'apple' },
    'ChromeOS': { source: 'logos', key: 'chrome' },
    'Windows Server': { source: 'logos', key: 'microsoft-windows-icon' },
}

export const SKILL_DEVELOPER_ICON_OVERRIDES: Readonly<Record<string, string>> = {
    ChatGPT: 'ChatGPT',
    DeepSeek: 'DeepSeek',
    'Axure RP': 'Axure',
}
