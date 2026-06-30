import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fitMediaWithinBounds,
    MESSAGE_MEDIA_INLINE_BOUNDS,
    normalizeMediaDimensions,
} from '../../src/lib/messages/media-metadata';

test('normalizes complete positive media dimensions only', () => {
    assert.deepEqual(normalizeMediaDimensions('493', '739'), { width: 493, height: 739 });
    assert.deepEqual(normalizeMediaDimensions(1920.4, 1080.4), { width: 1920, height: 1080 });
    assert.equal(normalizeMediaDimensions(0, 1080), null);
    assert.equal(normalizeMediaDimensions(1920, null), null);
    assert.equal(normalizeMediaDimensions(Number.NaN, 1080), null);
});

test('fits portrait media without changing its aspect ratio', () => {
    const fitted = fitMediaWithinBounds(
        { width: 493, height: 739 },
        MESSAGE_MEDIA_INLINE_BOUNDS,
    );

    assert.deepEqual(fitted, { width: 240, height: 360 });
    assert.ok(Math.abs((fitted.width / fitted.height) - (493 / 739)) < 0.002);
});

test('fits wide media and never upscales small media', () => {
    assert.deepEqual(
        fitMediaWithinBounds(
            { width: 2400, height: 600 },
            MESSAGE_MEDIA_INLINE_BOUNDS,
        ),
        { width: 320, height: 80 },
    );
    assert.deepEqual(
        fitMediaWithinBounds(
            { width: 180, height: 240 },
            MESSAGE_MEDIA_INLINE_BOUNDS,
        ),
        { width: 180, height: 240 },
    );
});

test('inline media stays compact enough for popup and page message viewports', () => {
    assert.deepEqual(MESSAGE_MEDIA_INLINE_BOUNDS, {
        maxWidth: 320,
        maxHeight: 360,
    });
});
