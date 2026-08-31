import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mergeSocialLinkCollections,
    findSensitiveLinkParameters,
    isStaleSocialLinkStatus,
    normalizeSocialLinks,
    resolveSocialPresence,
    SOCIAL_PRESENCE,
    validateSocialLinkCollection,
    validateSocialLinkRecord,
} from '@/lib/profile/normalization';
import {
    areProjectSocialLinksEqual,
    countProjectLinkChanges,
    extractProjectLinkUrls,
    filterProjectLinksForAudience,
    hydrateProjectSocialLinks,
    inferProjectLinkPurpose,
    isProjectLinkMetadataStale,
    resolveProjectSocialLinks,
    splitProjectSocialLinks,
} from '@/lib/projects/social-links';
import { DOMAIN_PRESENCE_ICON_KEYS, DOMAIN_PRESENCE_RULES, SECTOR_ICON_KEYS } from '@/lib/profile/domain-presence';
import { normalizeLinkDestinationTitle } from '@/lib/links/destination-title';

test('resolves a recognised platform, its icon, and its account label locally', () => {
    assert.deepEqual(resolveSocialPresence('website', 'https://github.com/rama730'), {
        label: 'GitHub',
        url: 'https://github.com/rama730',
        platform: 'github',
        platformLabel: 'GitHub',
        accountLabel: 'rama730',
        iconKey: 'github',
        canonicalKey: 'github:github.com:rama730',
    });
});

test('uses the canonical X presentation for legacy Twitter URLs', () => {
    const link = resolveSocialPresence('twitter', 'https://twitter.com/network_builder');
    assert.equal(link?.platform, 'x');
    assert.equal(link?.platformLabel, 'X (Twitter)');
    assert.equal(link?.accountLabel, 'network builder');
    assert.equal(link?.iconKey, 'x');
});

test('the shared registry maps X to its intentional X mark rather than a generic icon', () => {
    assert.equal(SOCIAL_PRESENCE.x.iconKey, 'x');
    assert.equal(SOCIAL_PRESENCE.twitter.iconKey, 'x');
});

test('recognises research destinations and gives Google Scholar its dedicated icon', () => {
    const destinations = [
        ['https://scholar.google.com/citations?user=abc123&hl=en', 'google-scholar', 'google-scholar', 'Scholar profile'],
        ['https://www.researchgate.net/profile/Ada-Lovelace', 'researchgate', 'researchgate', 'Ada Lovelace'],
        ['https://orcid.org/0000-0002-1825-0097', 'orcid', 'orcid', '0000 0002 1825 0097'],
        ['https://arxiv.org/abs/2401.12345', 'arxiv', 'arxiv', '2401.12345'],
        ['https://doi.org/10.1000/example', 'doi', 'doi', '10.1000/example'],
        ['https://www.semanticscholar.org/paper/example/abc123', 'semantic-scholar', 'semantic-scholar', 'example'],
        ['https://example.academia.edu/Researcher', 'academia', 'academia', 'Researcher'],
        ['https://pubmed.ncbi.nlm.nih.gov/12345678/', 'pubmed', 'pubmed', '12345678'],
        ['https://zenodo.org/records/1234567', 'zenodo', 'zenodo', '1234567'],
        ['https://www.mendeley.com/catalogue/example-paper/', 'mendeley', 'mendeley', 'example paper'],
    ] as const;

    for (const [url, platform, iconKey, accountLabel] of destinations) {
        const link = resolveSocialPresence('website', url);
        assert.equal(link?.platform, platform);
        assert.equal(link?.iconKey, iconKey);
        assert.equal(link?.accountLabel, accountLabel);
        assert.equal(link?.url, url);
    }
});

test('previously generic community and publishing services use their own icons', () => {
    const destinations = [
        ['https://dribbble.com/designer', 'dribbble'],
        ['https://bsky.app/profile/example.com', 'bluesky'],
        ['https://mastodon.social/@researcher', 'mastodon'],
        ['https://www.threads.net/@creator', 'threads'],
        ['https://gitlab.com/group/project', 'gitlab'],
        ['https://bitbucket.org/team/project', 'bitbucket'],
        ['https://stackoverflow.com/users/123/example', 'stackoverflow'],
        ['https://codepen.io/example/pen/abc', 'codepen'],
        ['https://www.behance.net/designer', 'behance'],
        ['https://medium.com/@writer/article-123', 'medium'],
        ['https://publication.substack.com/p/article', 'substack'],
        ['https://www.reddit.com/r/research/', 'reddit'],
        ['https://www.tiktok.com/@creator/video/123', 'tiktok'],
    ] as const;

    for (const [url, platform] of destinations) {
        const link = resolveSocialPresence('website', url);
        assert.equal(link?.platform, platform);
        assert.equal(link?.iconKey, platform);
    }
});

test('recognises the product-design ecosystem without falling back to a globe', () => {
    const destinations = [
        ['https://www.behance.net/designer', 'behance'],
        ['https://dribbble.com/shots/123-product', 'dribbble'],
        ['https://www.figma.com/design/file-key/product?node-id=1-2', 'figma'],
        ['https://framer.com/projects/Product--abc', 'framer'],
        ['https://project.webflow.io/case-study', 'webflow'],
        ['https://www.canva.com/design/abc/view', 'canva'],
        ['https://www.sketch.com/s/abc/a/page', 'sketch'],
        ['https://app.zeplin.io/project/abc', 'zeplin'],
        ['https://projects.invisionapp.com/share/ABC', 'invision'],
        ['https://miro.com/app/board/abc/', 'miro'],
        ['https://pr.to/ABC', 'proto-io'],
        ['https://share.proto.io/ABC/', 'proto-io'],
        ['https://preview.uxpin.com/abc', 'uxpin'],
        ['https://designer.myportfolio.com/work', 'adobe-portfolio'],
        ['https://pin.it/abc', 'pinterest'],
        ['https://www.awwwards.com/sites/example', 'awwwards'],
        ['https://www.loom.com/share/abc', 'loom'],
        ['https://design.penpot.app/#/view/abc', 'penpot'],
        ['https://rive.app/community/files/abc/', 'rive'],
        ['https://t.maze.co/123', 'maze'],
        ['https://mobbin.com/screens/abc', 'mobbin'],
        ['https://designer.uxfol.io/case-study', 'uxfolio'],
        ['https://readymag.com/designer/project/', 'readymag'],
        ['https://designer.cargo.site/work', 'cargo'],
        ['https://designer.carbonmade.com/', 'carbonmade'],
        ['https://www.coroflot.com/designer', 'coroflot'],
        ['https://contra.com/designer', 'contra'],
        ['https://app.spline.design/file/abc', 'spline'],
        ['https://balsamiq.cloud/abc/project', 'balsamiq'],
    ] as const;

    for (const [url, platform] of destinations) {
        const link = resolveSocialPresence('website', url);
        assert.equal(link?.platform, platform);
        assert.notEqual(link?.iconKey, 'globe');
        assert.equal(link?.url, url);
    }
});

test('the long-tail catalog has unique identities and broad sector coverage', () => {
    assert.ok(DOMAIN_PRESENCE_RULES.length >= 150);
    assert.ok(SECTOR_ICON_KEYS.length >= 30);

    const keys = DOMAIN_PRESENCE_RULES.map((rule) => rule.key);
    const domains = DOMAIN_PRESENCE_RULES.flatMap((rule) => rule.domains);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(domains).size, domains.length);
    assert.deepEqual(
        [...new Set(DOMAIN_PRESENCE_RULES.map((rule) => rule.iconKey))].sort(),
        [...DOMAIN_PRESENCE_ICON_KEYS].sort(),
    );
});

test('every catalog domain resolves to its intended service and preserves the destination', () => {
    for (const rule of DOMAIN_PRESENCE_RULES) {
        for (const domain of rule.domains) {
            const scopedPath = rule.pathPrefixes?.[0]
                ? `${rule.pathPrefixes[0].replace(/\/$/, '')}/resource/example`
                : '/resource/example';
            const url = `https://${domain}${scopedPath}?view=full#details`;
            const link = resolveSocialPresence('website', url);
            assert.equal(link?.serviceKey, rule.key, domain);
            assert.equal(link?.platformLabel, rule.label, domain);
            assert.equal(link?.iconKey, rule.iconKey, domain);
            assert.equal(link?.url, url, domain);
        }
    }
});

test('recognises Heliyon publications without mislabelling other Cell Press journals', () => {
    const url = 'https://www.cell.com/heliyon/fulltext/S2405-8440(21)00426-6';
    const heliyon = resolveSocialPresence('website', url);

    assert.equal(heliyon?.serviceKey, 'heliyon');
    assert.equal(heliyon?.platformLabel, 'Heliyon');
    assert.equal(heliyon?.iconKey, 'heliyon');
    assert.equal(heliyon?.url, url);
    assert.equal(inferProjectLinkPurpose(heliyon!), 'research-publication');

    const otherJournal = resolveSocialPresence('website', 'https://www.cell.com/cell/fulltext/example');
    assert.notEqual(otherJournal?.serviceKey, 'heliyon');
    assert.equal(otherJournal?.iconKey, 'globe');
});

test('recognises representative links across the professional ecosystem', () => {
    const destinations = [
        ['https://www.npmjs.com/package/example?activeTab=readme#usage', 'npm', 'code'],
        ['https://www.postman.com/team/workspace/project/collection/123', 'Postman', 'api'],
        ['https://huggingface.co/org/model?library=transformers', 'Hugging Face', 'ai'],
        ['https://public.tableau.com/views/example/Dashboard?:showVizHome=no', 'Tableau Public', 'analytics'],
        ['https://www.kaggle.com/datasets/example/data', 'Kaggle', 'data'],
        ['https://project.vercel.app/path?mode=preview#result', 'Vercel', 'cloud'],
        ['https://www.producthunt.com/posts/example', 'Product Hunt', 'business'],
        ['https://docs.google.com/document/d/abc/edit?tab=t.0#heading=h.1', 'Google Docs', 'docs'],
        ['https://drive.google.com/file/d/abc/view?usp=sharing', 'Google Drive', 'storage'],
        ['https://teams.microsoft.com/l/meetup-join/abc', 'Microsoft Teams', 'communication'],
        ['https://circle.so/community/post/abc', 'Circle', 'community'],
        ['https://lu.ma/example-event', 'Luma', 'events'],
        ['https://www.semrush.com/analytics/overview/?q=example.com', 'Semrush', 'marketing'],
        ['https://shop.example.myshopify.com/products/item', 'Shopify', 'commerce'],
        ['https://buy.stripe.com/example?prefilled_email=test%40example.com', 'Stripe', 'finance'],
        ['https://www.coursera.org/learn/example', 'Coursera', 'education'],
        ['https://clinicaltrials.gov/study/NCT00000000', 'ClinicalTrials.gov', 'health'],
        ['https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123', 'SSRN', 'legal'],
        ['https://www.hackerone.com/hacktivity/overview', 'HackerOne', 'security'],
        ['https://cad.onshape.com/documents/abc/w/def/e/ghi', 'Onshape', 'engineering'],
        ['https://store.steampowered.com/app/123/example/', 'Steam', 'gaming'],
        ['https://apps.apple.com/app/example/id123', 'Apple App Store', 'mobile'],
        ['https://zapier.com/apps/example/integrations', 'Zapier', 'automation'],
        ['https://example.bubbleapps.io/version-test/', 'Bubble', 'no-code'],
        ['https://www.upwork.com/freelancers/example', 'Upwork', 'careers'],
        ['https://etherscan.io/address/0x123#code', 'Etherscan', 'web3'],
        ['https://vimeo.com/123456789?share=copy#t=30s', 'Vimeo', 'video'],
        ['https://open.spotify.com/episode/abc?si=123', 'Spotify', 'audio'],
        ['https://publication.beehiiv.com/p/article', 'beehiiv', 'writing'],
        ['https://unsplash.com/photos/example?utm_source=profile', 'Unsplash', 'photography'],
    ] as const;

    for (const [url, platformLabel, iconKey] of destinations) {
        const link = resolveSocialPresence('website', url);
        assert.equal(link?.platformLabel, platformLabel);
        assert.equal(link?.iconKey, iconKey);
        assert.ok(link?.serviceKey);
        assert.equal(link?.url, url);
    }
});

test('an unknown public domain still receives the safe globe fallback', () => {
    const link = resolveSocialPresence('website', 'https://new-sector.example/resources/one?view=full#details');
    assert.equal(link?.platformLabel, 'Website');
    assert.equal(link?.iconKey, 'globe');
});

test('only a missing or gone destination is retained as a stale social link', () => {
    assert.equal(isStaleSocialLinkStatus(404), true);
    assert.equal(isStaleSocialLinkStatus(410), true);
    assert.equal(isStaleSocialLinkStatus(429), false);
    assert.equal(isStaleSocialLinkStatus(503), false);
});

test('falls back to a readable host for custom websites without exposing a raw URL', () => {
    const link = resolveSocialPresence('portfolio', 'https://studio.example.dev/work');
    assert.equal(link?.platformLabel, 'Portfolio');
    assert.equal(link?.accountLabel, 'studio.example.dev');
    assert.equal(link?.iconKey, 'globe');
});

test('normalization excludes malformed and private social destinations', () => {
    const links = normalizeSocialLinks({
        socialLinks: {
            github: 'https://github.com/rama730',
            website: 'javascript:alert(1)',
            other: 'http://localhost:3000',
        },
    });

    assert.equal(links.length, 1);
    assert.equal(links[0]?.accountLabel, 'rama730');
});

test('link writes reject unsafe schemes and canonicalize a mismatched platform', () => {
    assert.equal(validateSocialLinkRecord({ website: 'javascript:alert(1)' }).success, false);
    const valid = validateSocialLinkRecord({ linkedin: 'github.com/network-for-builders' });
    assert.deepEqual(valid, { success: true, links: { github: 'https://github.com/network-for-builders' } });
});

test('a URL-only social draft detects the service before it is saved', () => {
    const valid = validateSocialLinkRecord({ website: 'linkedin.com/in/ramanayudu-ch' });
    assert.deepEqual(valid, { success: true, links: { linkedin: 'https://linkedin.com/in/ramanayudu-ch' } });
});

test('YouTube links retain the exact video destination', () => {
    const watch = resolveSocialPresence('website', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking');
    assert.equal(watch?.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking');

    const short = resolveSocialPresence('website', 'https://youtu.be/dQw4w9WgXcQ?si=tracking&t=42');
    assert.equal(short?.url, 'https://youtu.be/dQw4w9WgXcQ?si=tracking&t=42');
});

test('resolved destination names replace opaque URL-route labels without changing the destination', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking';
    const validation = validateSocialLinkCollection([
        {
            id: 'video',
            platform: 'youtube',
            url,
            destinationLabel: 'A specific video title',
            order: 0,
        },
    ]);
    assert.equal(validation.success, true);
    if (!validation.success) return;
    assert.equal(validation.links[0]?.destinationLabel, 'A specific video title');

    const resolved = normalizeSocialLinks({ socialLinks: validation.links });
    assert.equal(resolved[0]?.platformLabel, 'YouTube');
    assert.equal(resolved[0]?.accountLabel, 'A specific video title');
    assert.equal(resolved[0]?.url, url);
});

test('provider metadata titles are decoded and stripped of provider chrome', () => {
    assert.equal(
        normalizeLinkDestinationTitle('A Video &amp; Demo - YouTube', 'youtube'),
        'A Video & Demo',
    );
    assert.equal(
        normalizeLinkDestinationTitle('\u202ADr. Ada Lovelace\u202C - \u202AGoogle Scholar\u202C', 'google-scholar'),
        'Dr. Ada Lovelace',
    );
});

test('all project-link platforms preserve path, query, and fragment semantics', () => {
    const destinations = [
        'https://github.com/example/project/blob/main/app.ts?plain=1#L42',
        'https://x.com/example/status/123456789?s=20#reply',
        'https://app.example.dev/workspaces/one?view=board&item=42#details',
        'https://portfolio.example.dev/case-study/?slide=3#prototype',
        'https://unknown.example.dev/resource?id=42#section',
        'https://www.figma.com/design/file-key/project?node-id=12-34&t=session#focus',
        'https://discord.gg/invite-code?event=123#details',
        'https://workspace.slack.com/archives/channel/p123456789?thread_ts=123.45#message',
        'https://example.notion.site/page-id?pvs=4#block-id',
        'https://www.linkedin.com/posts/example_post-123?utm_source=share#comments',
        'https://www.instagram.com/reel/example/?igsh=share#comments',
        'https://www.twitch.tv/videos/123456789?t=1h2m3s#chat',
        'https://www.facebook.com/watch/?v=123456789&ref=sharing#comments',
        'https://social.example/@person/123456?view=thread#reply',
    ];

    for (const destination of destinations) {
        assert.equal(resolveSocialPresence('website', destination)?.url, destination);
    }
});

test('project links infer a cross-sector purpose while preserving explicit owner intent', () => {
    const github = resolveSocialPresence('website', 'https://github.com/example/project');
    const scholar = resolveSocialPresence('website', 'https://scholar.google.com/citations?user=abc');
    const behance = resolveSocialPresence('website', 'https://behance.net/example');
    assert.ok(github && scholar && behance);
    assert.equal(inferProjectLinkPurpose(github!), 'source-code');
    assert.equal(inferProjectLinkPurpose(scholar!), 'research-publication');
    assert.equal(inferProjectLinkPurpose(behance!), 'design-prototype');

    const resolved = resolveProjectSocialLinks([{ id: 'repo', url: github!.url, purpose: 'documentation', audience: 'members' }]);
    assert.equal(resolved[0]?.purpose, 'documentation');
    assert.equal(resolved[0]?.audience, 'members');
});

test('derived project-link metadata is split from persisted user intent and can be hydrated again', () => {
    const checkedAt = '2026-08-30T00:00:00.000Z';
    const split = splitProjectSocialLinks([{
        id: 'paper',
        url: 'https://arxiv.org/abs/2401.12345',
        audience: 'public',
        metadata: { health: 'active', checkedAt, nameSource: 'open_graph', fetchedAt: checkedAt, resolvedHost: 'arxiv.org', contentType: 'text/html' },
    }]);
    assert.ok(!('error' in split));
    if ('error' in split) return;
    assert.equal(split.links[0]?.metadata, undefined);
    assert.equal(split.links[0]?.purpose, 'research-publication');
    assert.equal(split.metadata.paper?.nameSource, 'open_graph');
    assert.equal(hydrateProjectSocialLinks(split.links, split.metadata)[0]?.metadata?.health, 'active');
    assert.equal(isProjectLinkMetadataStale(split.metadata.paper, new Date('2026-09-15T00:00:00.000Z').getTime()), false);
    assert.equal(isProjectLinkMetadataStale(split.metadata.paper, new Date('2026-10-15T00:00:00.000Z').getTime()), true);
});

test('member-only project links are excluded from public read models', () => {
    const links = [
        { id: 'public', url: 'https://example.com', audience: 'public' as const },
        { id: 'internal', url: 'https://notion.site/internal', audience: 'members' as const },
    ];
    assert.deepEqual(filterProjectLinksForAudience(links, false).map((link) => link.id), ['public']);
    assert.deepEqual(filterProjectLinksForAudience(links, true).map((link) => link.id), ['public', 'internal']);
});

test('credential-like query parameters are surfaced without mutating the URL', () => {
    const url = 'https://example.com/share?view=full&token=secret&api_key=value#section';
    assert.deepEqual(findSensitiveLinkParameters(url), ['token', 'api_key']);
    assert.equal(resolveSocialPresence('website', url)?.url, url);
});

test('normalization preserves distinct resource state on the same account', () => {
    const links = normalizeSocialLinks({
        socialLinks: {
            github: 'https://github.com/rama730/',
            other: 'https://github.com/rama730?utm_source=profile',
        },
    });

    assert.equal(links.length, 2);
    assert.equal(links[0]?.url, 'https://github.com/rama730/');
    assert.equal(links[1]?.url, 'https://github.com/rama730?utm_source=profile');
});

test('project links use the same local platform presentation', () => {
    const links = resolveProjectSocialLinks({ github: 'https://github.com/network-for-builders/app' });
    assert.equal(links[0]?.platformLabel, 'GitHub');
    assert.equal(links[0]?.accountLabel, 'network for builders/app');
});

test('connected repositories are managed project links and deduplicate the same manual URL', () => {
    const links = resolveProjectSocialLinks(
        [
            { id: 'repo', platform: 'github', url: 'https://github.com/network-for-builders/app/', order: 0 },
            { id: 'site', platform: 'website', url: 'https://example.dev', order: 1 },
        ],
        'https://github.com/network-for-builders/app',
    );
    assert.equal(links.length, 2);
    assert.equal(links[0]?.id, 'github-integration');
    assert.equal(links[0]?.managed, 'github-integration');
    assert.equal(links[1]?.id, 'site');
});

test('invalid connected repository data never becomes a project link', () => {
    assert.deepEqual(resolveProjectSocialLinks([], 'https://example.dev/not-github'), []);
});

test('link collections reject values beyond the shared display limit', () => {
    const links = Array.from({ length: 21 }, (_, index) => ({ id: `site-${index}`, url: `https://example.dev/${index}`, order: index }));
    assert.equal(validateSocialLinkCollection(links).success, false);
});

test('V2 collections retain multiple custom sites, order, and custom labels', () => {
    const result = validateSocialLinkCollection([
        { id: 'portfolio', platform: 'website', url: 'https://studio.example.dev/work', label: 'Design work', order: 1 },
        { id: 'blog', platform: 'website', url: 'https://studio.example.dev/blog', label: 'Writing', order: 0 },
    ]);
    assert.equal(result.success, true);
    if (!result.success) return;
    const links = normalizeSocialLinks({ socialLinks: result.links });
    assert.equal(links.length, 2);
    assert.equal(links[0]?.customLabel, 'Writing');
    assert.equal(links[1]?.customLabel, 'Design work');
    assert.notEqual(links[0]?.canonicalKey, links[1]?.canonicalKey);
});

test('social-link conflict merge retains separately-added links and local edits', () => {
    const base = [{ id: 'github', platform: 'github', url: 'https://github.com/original', order: 0 }];
    const local = [{ id: 'github', platform: 'github', url: 'https://github.com/local', order: 0 }];
    const remote = [
        { id: 'github', platform: 'github', url: 'https://github.com/remote', order: 0 },
        { id: 'site', platform: 'website', url: 'https://example.dev', order: 1 },
    ];
    const merged = mergeSocialLinkCollections(base, local, remote);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.url, 'https://github.com/local');
    assert.equal(merged[1]?.url, 'https://example.dev/');
});

test('social-link conflict merge preserves an intentional local reorder', () => {
    const base = [
        { id: 'github', platform: 'github', url: 'https://github.com/original', order: 0 },
        { id: 'site', platform: 'website', url: 'https://example.dev', order: 1 },
    ];
    const local = [
        { ...base[1]!, order: 0 },
        { ...base[0]!, order: 1 },
    ];
    const remote = [...base, { id: 'blog', platform: 'website', url: 'https://blog.example.dev', order: 2 }];
    const merged = mergeSocialLinkCollections(base, local, remote);
    assert.deepEqual(merged.map((item) => item.id), ['site', 'github', 'blog']);
});

test('social-link conflict merge preserves an intentional local deletion', () => {
    const base = [
        { id: 'github', platform: 'github', url: 'https://github.com/original', order: 0 },
        { id: 'site', platform: 'website', url: 'https://example.dev', order: 1 },
    ];
    const merged = mergeSocialLinkCollections(base, [base[1]!], [...base, { id: 'docs', platform: 'website', url: 'https://docs.example.dev', order: 2 }]);
    assert.deepEqual(merged.map((item) => item.id), ['site', 'docs']);
});

test('project-link concurrency checks ignore object insertion order and hydrated defaults', () => {
    const storedLegacyLink = [{
        id: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc123&list=playlist',
        platform: 'youtube',
        order: 0,
    }];
    const editorBaseline = [{
        id: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc123&list=playlist',
        platform: 'youtube',
        audience: 'public' as const,
        order: 0,
        purpose: 'demo-media' as const,
    }];

    assert.equal(areProjectSocialLinksEqual(storedLegacyLink, editorBaseline), true);
});

test('project-link concurrency checks still detect meaningful edits and reorders', () => {
    const original = [
        { id: 'video', url: 'https://youtube.com/watch?v=one', order: 0 },
        { id: 'paper', url: 'https://scholar.google.com/citations?user=one', order: 1 },
    ];
    const renamed = original.map((link, index) => index === 0 ? { ...link, destinationLabel: 'New title' } : link);
    const reordered = [{ ...original[1]!, order: 0 }, { ...original[0]!, order: 1 }];

    assert.equal(areProjectSocialLinksEqual(original, renamed), false);
    assert.equal(areProjectSocialLinksEqual(original, reordered), false);
});

test('project-link paste extracts several unique URLs and change counts include reorder-only drafts', () => {
    assert.deepEqual(
        extractProjectLinkUrls('Watch https://youtu.be/abc, paper https://arxiv.org/abs/123. Again: https://youtu.be/abc'),
        ['https://youtu.be/abc', 'https://arxiv.org/abs/123'],
    );

    const saved = [
        { id: 'video', url: 'https://youtu.be/abc', order: 0 },
        { id: 'paper', url: 'https://arxiv.org/abs/123', order: 1 },
    ];
    assert.equal(countProjectLinkChanges(saved, saved), 0);
    assert.equal(countProjectLinkChanges(saved, [{ ...saved[1]!, order: 0 }, { ...saved[0]!, order: 1 }]), 1);
    assert.equal(countProjectLinkChanges(saved, [...saved, { id: 'site', url: 'https://example.com', order: 2 }]), 1);
});
