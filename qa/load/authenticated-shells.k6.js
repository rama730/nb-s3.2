import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';
const ROUTES = ['/hub', '/workspace', '/messages'];

export const options = {
    scenarios: {
        authenticated_shells: {
            executor: 'constant-arrival-rate',
            rate: 120,
            timeUnit: '1s',
            duration: '4m',
            preAllocatedVUs: 120,
            maxVUs: 300,
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<800'],
        checks: ['rate>0.99'],
    },
};

export default function authenticatedShells() {
    const route = ROUTES[__ITER % ROUTES.length];
    const response = http.get(`${BASE_URL}${route}`, {
        headers: {
            'user-agent': 'k6-authenticated-shells',
            'x-forwarded-for': `203.0.113.${(__VU % 240) + 10}`,
            'cookie': AUTH_COOKIE,
        },
        redirects: 0,
    });

    check(response, {
        'route returns app shell or auth redirect': (r) => [200, 302, 303, 503].includes(r.status),
        'route class header present when not redirected away': (r) =>
            ![200, 503].includes(r.status) || !!r.headers['X-Route-Class'],
    });

    sleep(0.15);
}

