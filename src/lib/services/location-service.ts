/**
 * Location Service
 * Fast, secure location detection using browser Geolocation API
 * Uses OpenStreetMap Nominatim for reverse geocoding (free, no API key)
 */

export interface LocationResult {
    city?: string
    state?: string
    country?: string
    formatted: string
}

/**
 * Get user's location using browser Geolocation API
 * Returns formatted string like "Hyderabad, Telangana, India"
 */
export async function getUserLocation(): Promise<{
    location: LocationResult | null
    error: string | null
}> {
    // Check if geolocation is supported
    if (!navigator.geolocation) {
        return { location: null, error: 'Geolocation not supported' }
    }

    try {
        // Get coordinates from browser
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false, // Faster, uses less battery
                timeout: 10000,
                maximumAge: 300000, // Cache for 5 minutes
            })
        })

        const { latitude, longitude } = position.coords

        // Reverse geocode using OpenStreetMap Nominatim (free, no API key)
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
            {
                headers: {
                    'Accept-Language': 'en',
                    'User-Agent': 'EdgePlatform/1.0',
                },
            }
        )

        if (!response.ok) {
            throw new Error('Geocoding failed')
        }

        const data = await response.json()
        const address = data.address || {}

        // Extract location parts
        const city = address.city || address.town || address.village || address.municipality || ''
        const state = address.state || address.region || ''
        const country = address.country || ''

        // Format location string
        const parts = [city, state, country].filter(Boolean)
        const formatted = parts.join(', ')

        return {
            location: { city, state, country, formatted },
            error: null,
        }
    } catch (error) {
        const err = error as GeolocationPositionError | Error

        if ('code' in err) {
            switch (err.code) {
                case 1: // PERMISSION_DENIED
                    return { location: null, error: 'Location permission denied' }
                case 2: // POSITION_UNAVAILABLE
                    return { location: null, error: 'Location unavailable' }
                case 3: // TIMEOUT
                    return { location: null, error: 'Location request timed out' }
            }
        }

        return { location: null, error: 'Failed to get location' }
    }
}

/**
 * Fallback: Get approximate location from IP (no permission needed)
 * Less accurate but faster and simpler
 */
export async function getLocationFromIP(): Promise<{
    location: LocationResult | null
    error: string | null
}> {
    try {
        const response = await fetch('https://ipapi.co/json/', {
            headers: { 'Accept': 'application/json' },
        })

        if (!response.ok) {
            throw new Error('IP lookup failed')
        }

        const data = await response.json()

        const city = data.city || ''
        const state = data.region || ''
        const country = data.country_name || ''

        const parts = [city, state, country].filter(Boolean)
        const formatted = parts.join(', ')

        return {
            location: { city, state, country, formatted },
            error: null,
        }
    } catch {
        return { location: null, error: 'Failed to detect location' }
    }
}

/**
 * Get location with fallback strategy
 * 1. Try browser geolocation (accurate, needs permission)
 * 2. Fallback to IP-based location (less accurate, no permission)
 */
export async function detectLocation(): Promise<{
    location: LocationResult | null
    error: string | null
    source: 'gps' | 'ip' | 'none'
}> {
    // Try GPS first
    const gpsResult = await getUserLocation()
    if (gpsResult.location) {
        return { ...gpsResult, source: 'gps' }
    }

    // Fallback to IP
    const ipResult = await getLocationFromIP()
    if (ipResult.location) {
        return { ...ipResult, source: 'ip' }
    }

    return { location: null, error: 'Could not detect location', source: 'none' }
}
