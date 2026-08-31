/**
 * Long-tail public-link recognition.
 *
 * First-class social platforms remain in profile/normalization.ts for storage
 * compatibility. This catalog covers professional tools and publishing
 * destinations without turning the link editor into a hundred-item picker.
 * Detection is local and domain-based: no visitor data is sent to third-party
 * metadata services.
 */

export const SECTOR_ICON_KEYS = [
    'ai',
    'analytics',
    'api',
    'audio',
    'automation',
    'business',
    'careers',
    'cloud',
    'code',
    'community',
    'commerce',
    'communication',
    'data',
    'docs',
    'education',
    'engineering',
    'events',
    'finance',
    'gaming',
    'health',
    'legal',
    'marketing',
    'mobile',
    'no-code',
    'photography',
    'security',
    'storage',
    'video',
    'web3',
    'writing',
] as const;

export type SectorIconKey = (typeof SECTOR_ICON_KEYS)[number];

export const DOMAIN_PRESENCE_ICON_KEYS = [
    ...SECTOR_ICON_KEYS,
    'heliyon',
] as const;

export type DomainPresenceIconKey = (typeof DOMAIN_PRESENCE_ICON_KEYS)[number];

export type DomainPresenceRule = {
    key: string;
    label: string;
    iconKey: DomainPresenceIconKey;
    domains: readonly string[];
    /** Restrict recognition on shared publisher hosts to one product path. */
    pathPrefixes?: readonly string[];
};

/**
 * Representative services across the professional ecosystem. A domain may
 * include subdomains automatically, so `spotify.com` also recognizes
 * `open.spotify.com`. Keep rules specific and never register broad shared
 * hosting suffixes that could mislabel an unrelated user site.
 */
export const DOMAIN_PRESENCE_RULES: readonly DomainPresenceRule[] = [
    // Software engineering, open source, package registries, and API work.
    { key: 'codeberg', label: 'Codeberg', iconKey: 'code', domains: ['codeberg.org'] },
    { key: 'sourceforge', label: 'SourceForge', iconKey: 'code', domains: ['sourceforge.net'] },
    { key: 'replit', label: 'Replit', iconKey: 'code', domains: ['replit.com'] },
    { key: 'codesandbox', label: 'CodeSandbox', iconKey: 'code', domains: ['codesandbox.io'] },
    { key: 'stackblitz', label: 'StackBlitz', iconKey: 'code', domains: ['stackblitz.com'] },
    { key: 'leetcode', label: 'LeetCode', iconKey: 'code', domains: ['leetcode.com'] },
    { key: 'hackerrank', label: 'HackerRank', iconKey: 'code', domains: ['hackerrank.com'] },
    { key: 'npm', label: 'npm', iconKey: 'code', domains: ['npmjs.com'] },
    { key: 'pypi', label: 'PyPI', iconKey: 'code', domains: ['pypi.org'] },
    { key: 'crates', label: 'crates.io', iconKey: 'code', domains: ['crates.io'] },
    { key: 'rubygems', label: 'RubyGems', iconKey: 'code', domains: ['rubygems.org'] },
    { key: 'packagist', label: 'Packagist', iconKey: 'code', domains: ['packagist.org'] },
    { key: 'maven-central', label: 'Maven Central', iconKey: 'code', domains: ['search.maven.org', 'central.sonatype.com'] },
    { key: 'nuget', label: 'NuGet', iconKey: 'code', domains: ['nuget.org'] },
    { key: 'docker-hub', label: 'Docker Hub', iconKey: 'code', domains: ['hub.docker.com'] },
    { key: 'github-pages', label: 'GitHub Pages', iconKey: 'code', domains: ['github.io'] },
    { key: 'postman', label: 'Postman', iconKey: 'api', domains: ['postman.com'] },
    { key: 'swaggerhub', label: 'SwaggerHub', iconKey: 'api', domains: ['swaggerhub.com'] },
    { key: 'rapidapi', label: 'RapidAPI', iconKey: 'api', domains: ['rapidapi.com'] },

    // AI, machine learning, data science, visualization, and analytics.
    { key: 'hugging-face', label: 'Hugging Face', iconKey: 'ai', domains: ['huggingface.co'] },
    { key: 'replicate', label: 'Replicate', iconKey: 'ai', domains: ['replicate.com'] },
    { key: 'civitai', label: 'Civitai', iconKey: 'ai', domains: ['civitai.com'] },
    { key: 'openai', label: 'OpenAI', iconKey: 'ai', domains: ['openai.com'] },
    { key: 'anthropic', label: 'Anthropic', iconKey: 'ai', domains: ['anthropic.com'] },
    { key: 'google-ai-studio', label: 'Google AI Studio', iconKey: 'ai', domains: ['aistudio.google.com', 'ai.google.dev'] },
    { key: 'kaggle', label: 'Kaggle', iconKey: 'data', domains: ['kaggle.com'] },
    { key: 'google-colab', label: 'Google Colab', iconKey: 'data', domains: ['colab.research.google.com'] },
    { key: 'observable', label: 'Observable', iconKey: 'data', domains: ['observablehq.com'] },
    { key: 'dataworld', label: 'data.world', iconKey: 'data', domains: ['data.world'] },
    { key: 'tableau-public', label: 'Tableau Public', iconKey: 'analytics', domains: ['public.tableau.com'] },
    { key: 'power-bi', label: 'Power BI', iconKey: 'analytics', domains: ['powerbi.com'] },
    { key: 'looker-studio', label: 'Looker Studio', iconKey: 'analytics', domains: ['lookerstudio.google.com'] },
    { key: 'dbt', label: 'dbt', iconKey: 'analytics', domains: ['getdbt.com'] },

    // Cloud infrastructure, deployment, and hosting.
    { key: 'vercel', label: 'Vercel', iconKey: 'cloud', domains: ['vercel.com', 'vercel.app'] },
    { key: 'netlify', label: 'Netlify', iconKey: 'cloud', domains: ['netlify.com', 'netlify.app'] },
    { key: 'render', label: 'Render', iconKey: 'cloud', domains: ['render.com'] },
    { key: 'railway', label: 'Railway', iconKey: 'cloud', domains: ['railway.app'] },
    { key: 'fly-io', label: 'Fly.io', iconKey: 'cloud', domains: ['fly.io', 'fly.dev'] },
    { key: 'heroku', label: 'Heroku', iconKey: 'cloud', domains: ['heroku.com', 'herokuapp.com'] },
    { key: 'cloudflare', label: 'Cloudflare', iconKey: 'cloud', domains: ['cloudflare.com', 'pages.dev'] },
    { key: 'firebase', label: 'Firebase', iconKey: 'cloud', domains: ['firebase.google.com', 'firebaseapp.com', 'web.app'] },
    { key: 'aws', label: 'Amazon Web Services', iconKey: 'cloud', domains: ['aws.amazon.com'] },
    { key: 'azure', label: 'Microsoft Azure', iconKey: 'cloud', domains: ['azure.microsoft.com'] },
    { key: 'google-cloud', label: 'Google Cloud', iconKey: 'cloud', domains: ['cloud.google.com'] },

    // Startups, business profiles, presentations, and professional discovery.
    { key: 'product-hunt', label: 'Product Hunt', iconKey: 'business', domains: ['producthunt.com'] },
    { key: 'indie-hackers', label: 'Indie Hackers', iconKey: 'business', domains: ['indiehackers.com'] },
    { key: 'crunchbase', label: 'Crunchbase', iconKey: 'business', domains: ['crunchbase.com'] },
    { key: 'wellfound', label: 'Wellfound', iconKey: 'business', domains: ['wellfound.com', 'angel.co'] },
    { key: 'pitch', label: 'Pitch', iconKey: 'business', domains: ['pitch.com'] },
    { key: 'gamma', label: 'Gamma', iconKey: 'business', domains: ['gamma.app'] },
    { key: 'slideshare', label: 'SlideShare', iconKey: 'business', domains: ['slideshare.net'] },

    // Project management, documents, knowledge, storage, and collaboration.
    { key: 'linear', label: 'Linear', iconKey: 'business', domains: ['linear.app'] },
    { key: 'jira', label: 'Jira', iconKey: 'business', domains: ['atlassian.net', 'jira.com'] },
    { key: 'trello', label: 'Trello', iconKey: 'business', domains: ['trello.com'] },
    { key: 'asana', label: 'Asana', iconKey: 'business', domains: ['asana.com'] },
    { key: 'clickup', label: 'ClickUp', iconKey: 'business', domains: ['clickup.com'] },
    { key: 'monday', label: 'monday.com', iconKey: 'business', domains: ['monday.com'] },
    { key: 'airtable', label: 'Airtable', iconKey: 'data', domains: ['airtable.com'] },
    { key: 'coda', label: 'Coda', iconKey: 'docs', domains: ['coda.io'] },
    { key: 'google-docs', label: 'Google Docs', iconKey: 'docs', domains: ['docs.google.com'] },
    { key: 'google-drive', label: 'Google Drive', iconKey: 'storage', domains: ['drive.google.com'] },
    { key: 'dropbox', label: 'Dropbox', iconKey: 'storage', domains: ['dropbox.com'] },
    { key: 'onedrive', label: 'OneDrive', iconKey: 'storage', domains: ['onedrive.live.com', '1drv.ms'] },
    { key: 'sharepoint', label: 'SharePoint', iconKey: 'storage', domains: ['sharepoint.com'] },
    { key: 'gitbook', label: 'GitBook', iconKey: 'docs', domains: ['gitbook.com', 'gitbook.io'] },
    { key: 'readme', label: 'ReadMe', iconKey: 'docs', domains: ['readme.com', 'readme.io'] },

    // Communication, scheduling, community, and events.
    { key: 'microsoft-teams', label: 'Microsoft Teams', iconKey: 'communication', domains: ['teams.microsoft.com'] },
    { key: 'zoom', label: 'Zoom', iconKey: 'communication', domains: ['zoom.us'] },
    { key: 'google-meet', label: 'Google Meet', iconKey: 'communication', domains: ['meet.google.com'] },
    { key: 'calendly', label: 'Calendly', iconKey: 'events', domains: ['calendly.com'] },
    { key: 'telegram', label: 'Telegram', iconKey: 'communication', domains: ['telegram.me', 't.me'] },
    { key: 'whatsapp', label: 'WhatsApp', iconKey: 'communication', domains: ['whatsapp.com', 'wa.me'] },
    { key: 'signal', label: 'Signal', iconKey: 'communication', domains: ['signal.me'] },
    { key: 'circle', label: 'Circle', iconKey: 'community', domains: ['circle.so'] },
    { key: 'discourse', label: 'Discourse', iconKey: 'community', domains: ['meta.discourse.org'] },
    { key: 'eventbrite', label: 'Eventbrite', iconKey: 'events', domains: ['eventbrite.com'] },
    { key: 'meetup', label: 'Meetup', iconKey: 'events', domains: ['meetup.com'] },
    { key: 'luma', label: 'Luma', iconKey: 'events', domains: ['lu.ma', 'luma.com'] },
    { key: 'sessionize', label: 'Sessionize', iconKey: 'events', domains: ['sessionize.com'] },

    // Marketing, growth, sales, CRM, customer support, and forms.
    { key: 'hubspot', label: 'HubSpot', iconKey: 'marketing', domains: ['hubspot.com'] },
    { key: 'mailchimp', label: 'Mailchimp', iconKey: 'marketing', domains: ['mailchimp.com'] },
    { key: 'buffer', label: 'Buffer', iconKey: 'marketing', domains: ['buffer.com'] },
    { key: 'hootsuite', label: 'Hootsuite', iconKey: 'marketing', domains: ['hootsuite.com'] },
    { key: 'semrush', label: 'Semrush', iconKey: 'marketing', domains: ['semrush.com'] },
    { key: 'ahrefs', label: 'Ahrefs', iconKey: 'marketing', domains: ['ahrefs.com'] },
    { key: 'linktree', label: 'Linktree', iconKey: 'marketing', domains: ['linktr.ee'] },
    { key: 'beacons', label: 'Beacons', iconKey: 'marketing', domains: ['beacons.ai'] },
    { key: 'salesforce', label: 'Salesforce', iconKey: 'business', domains: ['salesforce.com'] },
    { key: 'pipedrive', label: 'Pipedrive', iconKey: 'business', domains: ['pipedrive.com'] },
    { key: 'intercom', label: 'Intercom', iconKey: 'communication', domains: ['intercom.com'] },
    { key: 'zendesk', label: 'Zendesk', iconKey: 'communication', domains: ['zendesk.com'] },
    { key: 'freshdesk', label: 'Freshdesk', iconKey: 'communication', domains: ['freshdesk.com'] },
    { key: 'typeform', label: 'Typeform', iconKey: 'docs', domains: ['typeform.com'] },
    { key: 'jotform', label: 'Jotform', iconKey: 'docs', domains: ['jotform.com'] },
    { key: 'tally', label: 'Tally', iconKey: 'docs', domains: ['tally.so'] },

    // Publishing, writing, video, audio, photography, and creator platforms.
    { key: 'vimeo', label: 'Vimeo', iconKey: 'video', domains: ['vimeo.com'] },
    { key: 'spotify', label: 'Spotify', iconKey: 'audio', domains: ['spotify.com'] },
    { key: 'soundcloud', label: 'SoundCloud', iconKey: 'audio', domains: ['soundcloud.com'] },
    { key: 'bandcamp', label: 'Bandcamp', iconKey: 'audio', domains: ['bandcamp.com'] },
    { key: 'apple-music', label: 'Apple Music', iconKey: 'audio', domains: ['music.apple.com'] },
    { key: 'apple-podcasts', label: 'Apple Podcasts', iconKey: 'audio', domains: ['podcasts.apple.com'] },
    { key: 'beehiiv', label: 'beehiiv', iconKey: 'writing', domains: ['beehiiv.com'] },
    { key: 'ghost', label: 'Ghost', iconKey: 'writing', domains: ['ghost.io'] },
    { key: 'wordpress', label: 'WordPress', iconKey: 'writing', domains: ['wordpress.com'] },
    { key: 'devto', label: 'DEV Community', iconKey: 'writing', domains: ['dev.to'] },
    { key: 'hashnode', label: 'Hashnode', iconKey: 'writing', domains: ['hashnode.com', 'hashnode.dev'] },
    { key: 'artstation', label: 'ArtStation', iconKey: 'photography', domains: ['artstation.com'] },
    { key: 'deviantart', label: 'DeviantArt', iconKey: 'photography', domains: ['deviantart.com'] },
    { key: 'unsplash', label: 'Unsplash', iconKey: 'photography', domains: ['unsplash.com'] },
    { key: 'five-hundred-px', label: '500px', iconKey: 'photography', domains: ['500px.com'] },
    { key: 'flickr', label: 'Flickr', iconKey: 'photography', domains: ['flickr.com'] },

    // Commerce, payments, memberships, finance, and investing.
    { key: 'shopify', label: 'Shopify', iconKey: 'commerce', domains: ['shopify.com', 'myshopify.com'] },
    { key: 'etsy', label: 'Etsy', iconKey: 'commerce', domains: ['etsy.com'] },
    { key: 'amazon', label: 'Amazon', iconKey: 'commerce', domains: ['amazon.com', 'amzn.to'] },
    { key: 'ebay', label: 'eBay', iconKey: 'commerce', domains: ['ebay.com'] },
    { key: 'gumroad', label: 'Gumroad', iconKey: 'commerce', domains: ['gumroad.com'] },
    { key: 'lemon-squeezy', label: 'Lemon Squeezy', iconKey: 'commerce', domains: ['lemonsqueezy.com'] },
    { key: 'stripe', label: 'Stripe', iconKey: 'finance', domains: ['stripe.com'] },
    { key: 'paypal', label: 'PayPal', iconKey: 'finance', domains: ['paypal.com', 'paypal.me'] },
    { key: 'patreon', label: 'Patreon', iconKey: 'commerce', domains: ['patreon.com'] },
    { key: 'ko-fi', label: 'Ko-fi', iconKey: 'commerce', domains: ['ko-fi.com'] },
    { key: 'buy-me-a-coffee', label: 'Buy Me a Coffee', iconKey: 'commerce', domains: ['buymeacoffee.com'] },
    { key: 'tradingview', label: 'TradingView', iconKey: 'finance', domains: ['tradingview.com'] },
    { key: 'coinbase', label: 'Coinbase', iconKey: 'finance', domains: ['coinbase.com'] },
    { key: 'binance', label: 'Binance', iconKey: 'finance', domains: ['binance.com'] },
    { key: 'wise', label: 'Wise', iconKey: 'finance', domains: ['wise.com'] },

    // Education, credentials, healthcare, science, legal, and security.
    { key: 'coursera', label: 'Coursera', iconKey: 'education', domains: ['coursera.org'] },
    { key: 'udemy', label: 'Udemy', iconKey: 'education', domains: ['udemy.com'] },
    { key: 'edx', label: 'edX', iconKey: 'education', domains: ['edx.org'] },
    { key: 'khan-academy', label: 'Khan Academy', iconKey: 'education', domains: ['khanacademy.org'] },
    { key: 'skillshare', label: 'Skillshare', iconKey: 'education', domains: ['skillshare.com'] },
    { key: 'pluralsight', label: 'Pluralsight', iconKey: 'education', domains: ['pluralsight.com'] },
    { key: 'credly', label: 'Credly', iconKey: 'education', domains: ['credly.com'] },
    { key: 'clinical-trials', label: 'ClinicalTrials.gov', iconKey: 'health', domains: ['clinicaltrials.gov'] },
    { key: 'protocols', label: 'protocols.io', iconKey: 'health', domains: ['protocols.io'] },
    { key: 'biorxiv', label: 'bioRxiv', iconKey: 'health', domains: ['biorxiv.org'] },
    { key: 'medrxiv', label: 'medRxiv', iconKey: 'health', domains: ['medrxiv.org'] },
    // ponytail: A path-scoped catalog rule keeps shared publisher hosts out of one-off resolver logic.
    { key: 'heliyon', label: 'Heliyon', iconKey: 'heliyon', domains: ['cell.com'], pathPrefixes: ['/heliyon'] },
    { key: 'osf', label: 'Open Science Framework', iconKey: 'data', domains: ['osf.io'] },
    { key: 'figshare', label: 'figshare', iconKey: 'data', domains: ['figshare.com'] },
    { key: 'ssrn', label: 'SSRN', iconKey: 'legal', domains: ['ssrn.com'] },
    { key: 'clio', label: 'Clio', iconKey: 'legal', domains: ['clio.com'] },
    { key: 'hackerone', label: 'HackerOne', iconKey: 'security', domains: ['hackerone.com'] },
    { key: 'bugcrowd', label: 'Bugcrowd', iconKey: 'security', domains: ['bugcrowd.com'] },
    { key: 'hack-the-box', label: 'Hack The Box', iconKey: 'security', domains: ['hackthebox.com'] },
    { key: 'tryhackme', label: 'TryHackMe', iconKey: 'security', domains: ['tryhackme.com'] },
    { key: 'snyk', label: 'Snyk', iconKey: 'security', domains: ['snyk.io'] },

    // Architecture, hardware, industrial design, and making.
    { key: 'autodesk', label: 'Autodesk', iconKey: 'engineering', domains: ['autodesk.com'] },
    { key: 'onshape', label: 'Onshape', iconKey: 'engineering', domains: ['onshape.com'] },
    { key: 'grabcad', label: 'GrabCAD', iconKey: 'engineering', domains: ['grabcad.com'] },
    { key: 'thingiverse', label: 'Thingiverse', iconKey: 'engineering', domains: ['thingiverse.com'] },
    { key: 'printables', label: 'Printables', iconKey: 'engineering', domains: ['printables.com'] },
    { key: 'tinkercad', label: 'Tinkercad', iconKey: 'engineering', domains: ['tinkercad.com'] },
    { key: 'arduino', label: 'Arduino', iconKey: 'engineering', domains: ['arduino.cc'] },
    { key: 'hackster', label: 'Hackster.io', iconKey: 'engineering', domains: ['hackster.io'] },

    // Games, mobile distribution, no-code tools, careers, and Web3.
    { key: 'steam', label: 'Steam', iconKey: 'gaming', domains: ['steampowered.com', 'steamcommunity.com'] },
    { key: 'itch-io', label: 'itch.io', iconKey: 'gaming', domains: ['itch.io'] },
    { key: 'epic-games', label: 'Epic Games', iconKey: 'gaming', domains: ['epicgames.com'] },
    { key: 'unity', label: 'Unity', iconKey: 'gaming', domains: ['unity.com'] },
    { key: 'unreal-engine', label: 'Unreal Engine', iconKey: 'gaming', domains: ['unrealengine.com'] },
    { key: 'roblox', label: 'Roblox', iconKey: 'gaming', domains: ['roblox.com'] },
    { key: 'apple-app-store', label: 'Apple App Store', iconKey: 'mobile', domains: ['apps.apple.com'] },
    { key: 'google-play', label: 'Google Play', iconKey: 'mobile', domains: ['play.google.com'] },
    { key: 'zapier', label: 'Zapier', iconKey: 'automation', domains: ['zapier.com'] },
    { key: 'make', label: 'Make', iconKey: 'automation', domains: ['make.com'] },
    { key: 'n8n', label: 'n8n', iconKey: 'automation', domains: ['n8n.io'] },
    { key: 'bubble', label: 'Bubble', iconKey: 'no-code', domains: ['bubble.io', 'bubbleapps.io'] },
    { key: 'glide', label: 'Glide', iconKey: 'no-code', domains: ['glideapps.com', 'glide.page'] },
    { key: 'softr', label: 'Softr', iconKey: 'no-code', domains: ['softr.io'] },
    { key: 'adalo', label: 'Adalo', iconKey: 'no-code', domains: ['adalo.com'] },
    { key: 'upwork', label: 'Upwork', iconKey: 'careers', domains: ['upwork.com'] },
    { key: 'fiverr', label: 'Fiverr', iconKey: 'careers', domains: ['fiverr.com'] },
    { key: 'toptal', label: 'Toptal', iconKey: 'careers', domains: ['toptal.com'] },
    { key: 'freelancer', label: 'Freelancer', iconKey: 'careers', domains: ['freelancer.com'] },
    { key: 'etherscan', label: 'Etherscan', iconKey: 'web3', domains: ['etherscan.io'] },
    { key: 'opensea', label: 'OpenSea', iconKey: 'web3', domains: ['opensea.io'] },
    { key: 'mirror', label: 'Mirror', iconKey: 'web3', domains: ['mirror.xyz'] },
    { key: 'foundation', label: 'Foundation', iconKey: 'web3', domains: ['foundation.app'] },
    { key: 'rarible', label: 'Rarible', iconKey: 'web3', domains: ['rarible.com'] },
    { key: 'polygonscan', label: 'PolygonScan', iconKey: 'web3', domains: ['polygonscan.com'] },
    { key: 'solscan', label: 'Solscan', iconKey: 'web3', domains: ['solscan.io'] },
] as const;

export function findDomainPresence(hostname: string, pathname = '/'): DomainPresenceRule | null {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    const path = pathname.startsWith('/') ? pathname.toLowerCase() : `/${pathname.toLowerCase()}`;
    return DOMAIN_PRESENCE_RULES.find((rule) => {
        const matchesDomain = rule.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
        if (!matchesDomain) return false;
        if (!rule.pathPrefixes?.length) return true;
        return rule.pathPrefixes.some((prefix) => {
            const normalizedPrefix = `/${prefix.toLowerCase()}`.replace(/^\/\/+/, '/').replace(/\/+$/, '');
            return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
        });
    }) || null;
}
