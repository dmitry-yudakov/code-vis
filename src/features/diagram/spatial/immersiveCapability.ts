import type { ImmersiveAvailability, ImmersiveXRAdapter } from './immersiveTypes';

export interface ImmersiveCapabilityResult {
  availability: Extract<ImmersiveAvailability, 'available' | 'insecure' | 'unsupported' | 'failed'>;
  reason?: string;
}

export function browserImmersiveAdapter(): ImmersiveXRAdapter | undefined {
  if (typeof window === 'undefined') return undefined;
  if (window.__CODEAI_XR_TEST__?.adapter) return window.__CODEAI_XR_TEST__.adapter;
  const xr = navigator.xr;
  if (!xr) return undefined;
  return {
    isSessionSupported: (mode) => xr.isSessionSupported(mode),
  };
}

export async function probeImmersiveCapability({
  secure = typeof window !== 'undefined' && window.isSecureContext,
  authorized = true,
  adapter = browserImmersiveAdapter(),
}: {
  secure?: boolean;
  authorized?: boolean;
  adapter?: ImmersiveXRAdapter;
} = {}): Promise<ImmersiveCapabilityResult> {
  if (!authorized) {
    return { availability: 'unsupported', reason: 'Pair this device before opening an immersive workspace.' };
  }
  if (!secure) {
    return {
      availability: 'insecure',
      reason: 'WebXR needs a trusted HTTPS origin. Use the paired npm run start:remote address; an HTTP LAN development URL is not secure.',
    };
  }
  if (!adapter) {
    return { availability: 'unsupported', reason: 'This browser does not provide immersive WebXR.' };
  }
  try {
    return await adapter.isSessionSupported('immersive-vr')
      ? { availability: 'available' }
      : { availability: 'unsupported', reason: 'This browser or headset does not support immersive VR sessions.' };
  } catch (error) {
    return {
      availability: 'failed',
      reason: error instanceof Error ? error.message : 'WebXR capability checking failed.',
    };
  }
}
