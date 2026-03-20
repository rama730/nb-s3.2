import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const ROUTES = ['/login', '/signup', '/verify-email'];

export const options = {
    scenarios: {
        auth_entry_pages: {
            executor: 'constant-arrival-rate',
            rate: 90,
            timeUnit: '1s',
            duration: '3m',
            preAllocatedVUs: 60,
            maxVUs: 180,
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<500'],
        checks: ['rate>0.99'],
    },
};

export default function authEntryPages() {
    const route = ROUTES[__ITER % ROUTES.length];
    const response = http.get(`${BASE_URL}${route}`, {
        headers: {
            'user-agent': 'k6-auth-entry-pages',
            'x-forwarded-for': `192.0.2.${(__VU % 240) + 10}`,
        },
        redirects: 0,
    });

    check(response, {
        'auth entry route returns page or redirect': (r) => [200, 302, 303, 503].includes(r.status),
    });

    sleep(0.1);
}
