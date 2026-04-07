'use client';

import { useCallback, useEffect, useState } from 'react';

export function useNotificationPermission() {
    const [permission, setPermission] = useState<NotificationPermission>(
        typeof Notification !== 'undefined' ? Notification.permission : 'default',
    );

    useEffect(() => {
        if (typeof Notification === 'undefined') return;
        setPermission(Notification.permission);
    }, []);

    const requestPermission = useCallback(async () => {
        if (typeof Notification === 'undefined') return;
        const result = await Notification.requestPermission();
        setPermission(result);
    }, []);

    const sendNotification = useCallback((title: string, options?: NotificationOptions) => {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
            new Notification(title, options);
        } catch {
            // Silent fail on environments that don't support notifications
        }
    }, []);

    return { permission, requestPermission, sendNotification };
}
