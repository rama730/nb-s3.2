import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const options = {
    scenarios: {
        username_check_spike: {
            executor: 'ramping-arrival-rate',
            startRate: 10,
            timeUnit: '1s',
            preAllocatedVUs: 50,
            maxVUs: 300,
            stages: [
                { target: 50, duration: '30s' },
                { target: 100, duration: '45s' },
                { target: 150, duration: '45s' },
                { target: 0, duration: '20s' },
            ],
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<300'],
        checks: ['rate>0.99'],
    },
};

export default function () {
    const suffix = `${String(__VU).padStart(4, '0')}${String(__ITER).padStart(8, '0')}`;
    const username = `load_${suffix}`;
    const url = `${BASE_URL}/api/onboarding/username-check?username=${encodeURIComponent(username)}`;

    const response = http.get(url, {
        headers: {
            'user-agent': 'k6-onboarding-load',
            'x-forwarded-for': `203.0.113.${(__VU % 240) + 10}`,
        },
    });

    check(response, {
        'status is 200/400/429': (r) => [200, 400, 429].includes(r.status),
    });

    sleep(0.1);
}
