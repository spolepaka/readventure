/**
 * Get a stable player ID for the current user
 * @param playcademyId - The Playcademy user ID if available
 * @returns A stable player ID - either the Playcademy ID or a device-specific ID
 */
export function getPlayerId(playcademyId?: string): string {
    if (playcademyId) {
        return playcademyId;
    }
    
    // For anonymous/dev users, use a device-specific ID stored in localStorage
    let deviceId = localStorage.getItem('mathRaidersDeviceId');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('mathRaidersDeviceId', deviceId);
    }
    
    return `anon_${deviceId}`;
}

















































