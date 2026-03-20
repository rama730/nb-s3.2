import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';

export const options = {
    scenarios: {
        reconnect_storm: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 25 },
                { duration: '30s', target: 100 },
                { duration: '1m', target: 250 },
                { duration: '30s', target: 0 },
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.03'],
        http_req_duration: ['p(95)<900'],
        checks: ['rate>0.99'],
    },
};

export default function messagesReconnectStorm() {
    const response = http.get(`${BASE_URL}/messages`, {
        headers: {
            'user-agent': 'k6-messages-reconnect-storm',
            'x-forwarded-for': `198.51.100.${(__VU % 240) + 10}`,
            'cookie': AUTH_COOKIE,
            'cache-control': 'no-cache',
        },
        redirects: 0,
    });

    check(response, {
        'messages returns shell or controlled redirect': (r) => [200, 302, 303, 503].includes(r.status),
    });

    sleep(Math.random() * 0.4);
}

