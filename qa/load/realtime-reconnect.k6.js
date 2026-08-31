import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const REALTIME_URL = __ENV.SUPABASE_REALTIME_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const ACCESS_TOKEN = __ENV.SUPABASE_ACCESS_TOKEN;
const TOPIC = __ENV.REALTIME_TOPIC;

const joinDuration = new Trend('realtime_join_ms', true);
const joinFailures = new Rate('realtime_join_failed');
const joinedChannels = new Counter('realtime_channels_joined');
const receivedMessages = new Counter('realtime_messages_received');
const duplicateMessages = new Counter('realtime_duplicate_messages');

export const options = {
    scenarios: {
        bounded_reconnect: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 5 },
                { duration: '40s', target: 20 },
                { duration: '20s', target: 0 },
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: {
        checks: ['rate>0.99'],
        realtime_join_failed: ['rate<0.01'],
        realtime_join_ms: ['p(95)<1500'],
        realtime_duplicate_messages: ['count==0'],
    },
};

export default function realtimeReconnect() {
    const startedAt = Date.now();
    const joinRef = `${__VU}-${__ITER}-${startedAt}`;
    const seenRefs = {};
    let joined = false;
    const url = `${REALTIME_URL.replace(/\/$/, '')}/websocket?apikey=${encodeURIComponent(ANON_KEY)}&vsn=1.0.0`;
    const response = ws.connect(url, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    }, (socket) => {
        socket.on('open', () => {
            socket.send(JSON.stringify({
                topic: `realtime:${TOPIC}`,
                event: 'phx_join',
                payload: {
                    config: {
                        private: true,
                        broadcast: { ack: true, self: true },
                        presence: { key: `k6-${__VU}` },
                        postgres_changes: [],
                    },
                    access_token: ACCESS_TOKEN,
                },
                ref: joinRef,
            }));
        });

        socket.on('message', (raw) => {
            const message = JSON.parse(raw);
            receivedMessages.add(1);
            if (message.ref) {
                const key = `${message.event}:${message.ref}:${message.topic || ''}`;
                if (seenRefs[key]) duplicateMessages.add(1);
                seenRefs[key] = true;
            }
            if (message.event === 'phx_reply' && message.ref === joinRef) {
                joined = message.payload?.status === 'ok';
                joinFailures.add(!joined);
                if (joined) {
                    joinedChannels.add(1);
                    joinDuration.add(Date.now() - startedAt);
                    socket.send(JSON.stringify({
                        topic: `realtime:${TOPIC}`,
                        event: 'broadcast',
                        payload: { type: 'broadcast', event: 'load_probe', payload: {} },
                        ref: `${joinRef}-broadcast`,
                    }));
                }
            }
        });

        socket.setTimeout(() => socket.close(), 1500 + Math.random() * 1500);
    });

    check(response, {
        'realtime websocket upgraded': (result) => result && result.status === 101,
        'private realtime channel joined': () => joined,
    });
    if (!joined) joinFailures.add(true);
    sleep(0.25 + Math.random() * 0.5);
}
