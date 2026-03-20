import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';
const WORKER_BASE_URL = __ENV.WORKER_BASE_URL || BASE_URL;
const WORKER_LOAD_URL = __ENV.WORKER_LOAD_URL || `${WORKER_BASE_URL}/api/v1/inngest`;

export const options = {
    scenarios: {
        user_shell_traffic: {
            executor: 'ramping-vus',
            exec: 'userShellTraffic',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 },
                { duration: '1m', target: 80 },
                { duration: '30s', target: 0 },
            ],
            gracefulRampDown: '10s',
        },
        worker_plane_probe: {
            executor: 'ramping-vus',
            exec: 'workerPlaneProbe',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 10 },
                { duration: '1m', target: 40 },
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

export function userShellTraffic() {
    const route = __ITER % 2 === 0 ? '/workspace' : '/hub';
    const response = http.get(`${BASE_URL}${route}`, {
        headers: {
            'cookie': AUTH_COOKIE,
            'user-agent': 'k6-worker-isolation-shells',
            'x-forwarded-for': `198.51.100.${(__VU % 240) + 10}`,
            'cache-control': 'no-cache',
        },
        redirects: 0,
    });

    check(response, {
        'shell route returns success or controlled redirect': (r) => [200, 302, 303, 503].includes(r.status),
    });

    sleep(0.1);
}

export function workerPlaneProbe() {
    const response = http.get(WORKER_LOAD_URL, {
        headers: {
            'user-agent': 'k6-worker-isolation-probe',
            'x-forwarded-for': `198.51.101.${(__VU % 240) + 10}`,
            'cache-control': 'no-cache',
        },
        redirects: 0,
    });

    check(response, {
        'worker ingress responds': (r) => [200, 202, 204, 404, 405].includes(r.status),
    });

    sleep(0.05);
}

export default userShellTraffic;
