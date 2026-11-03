/** Normalize exact HTTPS origins sharing the primary listener's port, primary first. */
export function parsePublicOrigins(primary: string, additional?: string): string[];
