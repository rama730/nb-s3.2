import { set, del } from 'idb-keyval';

self.onmessage = async (e: MessageEvent) => {
    const { type, key, value } = e.data;
    try {
        if (type === 'set') {
            await set(key, value);
        } else if (type === 'del') {
            await del(key);
        }
    } catch (err) {
        // Safe logging in worker thread
        console.error('[dbWorker] storage write error', err);
    }
};
