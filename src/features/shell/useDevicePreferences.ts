'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEVICE_PREFERENCES_STORAGE_KEY,
  parseDevicePreferences,
  serializeDevicePreferences,
  type DevicePreferences,
} from './devicePreferences';

export function useDevicePreferences() {
  const [preferences, setPreferences] = useState<DevicePreferences>({});
  const preferencesRef = useRef(preferences);
  const readyRef = useRef(false);

  useEffect(() => {
    try {
      preferencesRef.current = parseDevicePreferences(localStorage.getItem(DEVICE_PREFERENCES_STORAGE_KEY));
      setPreferences(preferencesRef.current);
    } catch {
      // Preferences are optional device state; without storage every choice starts at its default.
    } finally {
      readyRef.current = true;
    }
  }, []);

  /** Saves in the same turn, like the device workspace, so a reload right after a choice keeps it. */
  const update = useCallback((change: (current: DevicePreferences) => DevicePreferences) => {
    const next = change(preferencesRef.current);
    preferencesRef.current = next;
    if (readyRef.current) {
      try { localStorage.setItem(DEVICE_PREFERENCES_STORAGE_KEY, serializeDevicePreferences(next)); } catch { /* optional */ }
    }
    setPreferences(next);
  }, []);

  return { preferences, update };
}
