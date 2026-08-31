import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('project link redirects use immutable ids, retain legacy keys, and suppress referrers', () => {
    const route = source('src/app/go/[ownerType]/[ownerId]/[linkKey]/route.ts');
    const surface = source('src/components/projects/dashboard/ProjectSocialLinksCard.tsx');
    assert.match(surface, /link\.id \|\| link\.canonicalKey/);
    assert.match(route, /item\.id === requestedLinkKey \|\| item\.canonicalKey === requestedLinkKey/);
    assert.match(route, /link\?\.audience === 'members'/);
    assert.match(route, /Referrer-Policy', 'no-referrer'/);
});

test('authenticated metadata previews are private and never log full requested URLs', () => {
    const route = source('src/app/api/v1/link-preview/route.ts');
    assert.match(route, /Cache-Control': 'private, max-age=300'/);
    assert.doesNotMatch(route, /requestedUrl:/);
    assert.match(route, /titleSource/);
    assert.match(route, /resolvedHost/);
});

test('Project Links has one canonical settings surface and participates in project search', () => {
    const settings = source('src/components/projects/tabs/ProjectSettingsTab.tsx');
    const search = source('src/hooks/useGlobalSearchPreviews.ts');
    assert.doesNotMatch(settings, /isProjectOwner\) return visible\.filter\(\(section\) => section\.id !== "links"/);
    assert.equal((settings.match(/<ProjectLinksManager/g) ?? []).length, 1);
    assert.match(search, /fetchProjectLinkPreviewsAction/);
    assert.match(search, /kind: "link" as const/);
});

test('hub workspace cards expose a privacy-filtered primary destination action', () => {
    const hubData = source('src/lib/data/hub.ts');
    const card = source('src/components/projects/ProjectCard.tsx');
    assert.match(hubData, /filterProjectLinksForAudience/);
    assert.match(card, /primaryProjectLink/);
    assert.match(card, /\/go\/project\/\$\{encodeURIComponent\(project\.id\)\}/);
});

test('the responsive project header exposes a labeled mobile links menu', () => {
    const surface = source('src/components/projects/dashboard/ProjectSocialLinksCard.tsx');
    assert.match(surface, /<>\s*<Link2[^>]*\/>Links/);
    assert.match(surface, /labelled className="sm:hidden"/);
});

test('project-link saves use semantic concurrency checks and a viewport-contained editor', () => {
    const action = source('src/app/actions/project/_all.ts');
    const surface = source('src/components/projects/dashboard/ProjectSocialLinksCard.tsx');
    assert.match(action, /areProjectSocialLinksEqual\(current, expected\.links\)/);
    assert.doesNotMatch(action, /JSON\.stringify\(current\)\s*!==\s*JSON\.stringify\(expected\.links\)/);
    assert.match(surface, /w-\[calc\(100vw-1rem\)\]/);
    assert.match(surface, /overflow-x-hidden overflow-y-auto/);
});

test('the project-link editor stages paste and drop, flushes on save, and exposes one commit action', () => {
    const surface = source('src/components/projects/dashboard/ProjectSocialLinksCard.tsx');
    const create = source('src/components/projects/create-wizard/phases/Phase4Settings.tsx');
    const edit = source('src/components/projects/EditProjectModal.tsx');
    assert.match(surface, /onPaste=/);
    assert.match(surface, /onDrop=/);
    assert.match(surface, /extractProjectLinkUrls/);
    assert.match(surface, /prepareForSave/);
    assert.match(surface, /event\.metaKey \|\| event\.ctrlKey/);
    assert.match(surface, /Discard your unsaved project link changes/);
    assert.match(surface, /sticky -bottom-4/);
    assert.match(surface, /Save changes/);
    assert.doesNotMatch(surface, />Add link</);
    assert.match(create, /savedLinks=\{\[\]\}/);
    assert.match(edit, /ref=\{projectLinksRef\}/);
});
