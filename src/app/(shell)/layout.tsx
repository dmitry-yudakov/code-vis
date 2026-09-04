import { AppShell } from '@/features/shell/AppShell';
import { DeviceAccessGate } from '@/features/devices/DeviceAccess';

export default function ShellLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DeviceAccessGate><AppShell>{children}</AppShell></DeviceAccessGate>;
}
