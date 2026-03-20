import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';

export const options = {
    scenarios: {
        workspace_bootstrap: {
            executor: 'ramping-arrival-rate',
            startRate: 10,
            timeUnit: '1s',
            preAllocatedVUs: 40,
            maxVUs: 160,
            stages: [
                { target: 50, duration: '1m' },
                { target: 100, duration: '2m' },
                { target: 0, duration: '30s' },
            ],
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<900'],
        checks: ['rate>0.99'],
    },
};

export default function workspaceBootstrap() {
    const response = http.get(`${BASE_URL}/workspace`, {
        headers: {
            'user-agent': 'k6-workspace-bootstrap',
            'x-forwarded-for': `203.0.113.${(__VU % 240) + 10}`,
            'cookie': AUTH_COOKIE,
        },
        redirects: 0,
    });

    check(response, {
        'workspace returns shell or overload/auth redirect': (r) => [200, 302, 303, 503].includes(r.status),
        'workspace route class header present on direct response': (r) =>
            ![200, 503].includes(r.status) || r.headers['X-Route-Class'] === 'active_surface',
    });

    sleep(0.2);
}

