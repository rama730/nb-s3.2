import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const SEEDED_CURSOR = 'eyJjcmVhdGVkQXQiOiIyMDI2LTAzLTEyVDEwOjAwOjAwLjAwMFoiLCJpZCI6InByb2plY3QtMDAxIn0';

export const options = {
    scenarios: {
        public_projects_feed: {
            executor: 'ramping-arrival-rate',
            startRate: 25,
            timeUnit: '1s',
            preAllocatedVUs: 80,
            maxVUs: 500,
            stages: [
                { target: 100, duration: '1m' },
                { target: 250, duration: '2m' },
                { target: 400, duration: '2m' },
                { target: 0, duration: '30s' },
            ],
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<400'],
        checks: ['rate>0.99'],
    },
};

export default function publicProjectsFeed() {
    const cursor = __ITER % 3 === 0
        ? ''
        : `&cursor=${encodeURIComponent(SEEDED_CURSOR)}`;
    const response = http.get(`${BASE_URL}/api/v1/projects?limit=24${cursor}`, {
        headers: {
            'user-agent': 'k6-public-projects-feed',
            'x-forwarded-for': `198.51.100.${(__VU % 240) + 10}`,
            'accept': 'application/json',
        },
    });

    check(response, {
        'feed returns success or shed state': (r) => [200, 429, 503].includes(r.status),
        'cache header present on success': (r) => r.status !== 200 || !!r.headers['X-Cache-State'],
    });

    sleep(0.1);
}
