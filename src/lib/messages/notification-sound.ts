let _audioElement: HTMLAudioElement | null = null;

export function playMessageSound() {
    try {
        if (typeof document === 'undefined') return;
        if (document.visibilityState !== 'hidden') return;
        if (!_audioElement) {
            _audioElement = new Audio('/sounds/message.mp3');
            _audioElement.volume = 0.3;
        }
        void _audioElement.play().catch(() => {
            // Browser may block autoplay — silently fail
        });
    } catch {
        // Silent fail
    }
}
