import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const EXTENSION_TOKEN = __ENV.EXTENSION_TOKEN || '';
const PROJECT_ID = __ENV.EXTENSION_PROJECT_ID || '';
const FILE_PATH = __ENV.EXTENSION_FILE_PATH || '';

const workspaceMs = new Trend('extension_workspace_ms');
const downloadIntentMs = new Trend('extension_download_intent_ms');
const rangeMs = new Trend('extension_signed_range_ms');

export const options = {
    scenarios: {
        extension_sync_read: {
            executor: 'ramping-arrival-rate',
            startRate: 5,
            timeUnit: '1s',
            preAllocatedVUs: 30,
            maxVUs: 120,
            stages: [
                { target: 30, duration: '1m' },
                { target: 60, duration: '2m' },
                { target: 0, duration: '30s' },
            ],
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<900'],
        checks: ['rate>0.99'],
        extension_workspace_ms: ['p(95)<900'],
        extension_download_intent_ms: ['p(95)<500'],
        extension_signed_range_ms: ['p(95)<1200'],
    },
};

function authHeaders() {
    return {
        authorization: `Bearer ${EXTENSION_TOKEN}`,
        'user-agent': 'k6-nb-vscode-sync',
        'x-extension-version': 'load-probe',
        'x-editor-host': 'k6',
        'x-editor-name': 'k6 extension probe',
        'x-editor-platform': 'load',
        'x-editor-version': 'load',
    };
}

export default function extensionSyncRead() {
    if (!EXTENSION_TOKEN || !PROJECT_ID || !FILE_PATH) {
        throw new Error('EXTENSION_TOKEN, EXTENSION_PROJECT_ID, and EXTENSION_FILE_PATH are required');
    }

    const workspaceStarted = Date.now();
    const workspace = http.get(`${BASE_URL}/api/v1/extension/workspace`, {
        headers: authHeaders(),
        redirects: 0,
    });
    workspaceMs.add(Date.now() - workspaceStarted);

    check(workspace, {
        'workspace endpoint returns extension payload': (r) => r.status === 200 && r.json('success') === true,
    });

    const intentStarted = Date.now();
    const downloadIntent = http.get(
        `${BASE_URL}/api/v1/extension/file?projectId=${encodeURIComponent(PROJECT_ID)}&path=${encodeURIComponent(FILE_PATH)}&transfer=signed`,
        { headers: authHeaders(), redirects: 0 },
    );
    downloadIntentMs.add(Date.now() - intentStarted);

    const signedUrl = downloadIntent.status === 200 ? downloadIntent.json('data.signedUrl') : '';
    check(downloadIntent, {
        'download intent returns signed URL or readable fallback status': (r) =>
            r.status === 200 && typeof signedUrl === 'string' && signedUrl.length > 0,
    });

    if (typeof signedUrl === 'string' && signedUrl.length > 0) {
        const rangeStarted = Date.now();
        const rangeResponse = http.get(signedUrl, {
            headers: { range: 'bytes=0-65535' },
            redirects: 0,
        });
        rangeMs.add(Date.now() - rangeStarted);
        check(rangeResponse, {
            'signed range returns bytes': (r) => [200, 206].includes(r.status) && r.body.length > 0,
        });
    }

    sleep(0.2);
}
