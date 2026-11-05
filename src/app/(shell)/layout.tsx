import { AppShell } from '@/features/shell/AppShell';
import { DeviceAccessGate } from '@/features/devices/DeviceAccess';
import { Suspense } from 'react';

export default function ShellLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DeviceAccessGate><Suspense fallback={null}><AppShell>{children}</AppShell></Suspense></DeviceAccessGate>;
}
