import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';
const PRESENCE_ROOM_ID = __ENV.PRESENCE_ROOM_ID || '';
const PRESENCE_ROOM_TYPE = __ENV.PRESENCE_ROOM_TYPE || 'workspace';
const PRESENCE_WS_LOAD_URL = __ENV.PRESENCE_WS_LOAD_URL || '';

const presenceAckMs = new Trend('presence_ack_ms');

export const options = {
    scenarios: {
        presence_room_fanout: {
            executor: 'ramping-vus',
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
        http_req_duration: ['p(95)<500'],
        checks: ['rate>0.99'],
        presence_ack_ms: ['p(95)<400'],
    },
};

export default function presenceRoomFanout() {
    const tokenResponse = http.post(`${BASE_URL}/api/realtime/presence-token`, JSON.stringify({
        roomType: PRESENCE_ROOM_TYPE,
        roomId: PRESENCE_ROOM_ID,
        role: PRESENCE_ROOM_TYPE === 'workspace' ? 'editor' : 'viewer',
    }), {
        headers: {
            'content-type': 'application/json',
            'cookie': AUTH_COOKIE,
            'user-agent': 'k6-presence-room-fanout',
            'x-forwarded-for': `198.51.100.${(__VU % 240) + 10}`,
        },
        redirects: 0,
    });

    const tokenPayload = tokenResponse.json();
    const token = tokenPayload?.data?.token || '';
    const preferredWsUrl = tokenPayload?.data?.wsUrl || PRESENCE_WS_LOAD_URL;

    check(tokenResponse, {
        'presence token issued': (r) => r.status === 200 && !!token,
    });
    if (!token) {
        sleep(0.2);
        return;
    }

    const wsUrl = `${preferredWsUrl}?token=${encodeURIComponent(token)}`;
    let ackReceived = false;
    const connectResult = ws.connect(wsUrl, { headers: { Origin: BASE_URL } }, (socket) => {
        const startedAt = Date.now();

        socket.on('open', () => {
            socket.send(JSON.stringify({ type: 'heartbeat' }));
        });

        socket.on('message', (data) => {
            try {
                const event = JSON.parse(data);
                if (event?.type === 'ack' && event?.ackType === 'heartbeat') {
                    ackReceived = true;
                    presenceAckMs.add(Date.now() - startedAt);
                    socket.close();
                }
            } catch {
                socket.close();
            }
        });

        socket.setTimeout(() => {
            socket.close();
        }, 4000);
    });

    check(connectResult, {
        'presence websocket upgraded': (r) => r && r.status === 101,
        'presence ack received': () => ackReceived,
    });

    sleep(0.1);
}
