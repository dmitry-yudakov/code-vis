import type { PublicSession } from '@/shared/types';

interface SubmittedDraftIdentity {
  text: number;
  reports: ReadonlyMap<string, number>;
}

/** Ownership lasts for this mounted workspace, independently of the text's value. */
export class DraftIdentity {
  private text = 0;
  private nextReport = 0;
  private reports = new Map<string, number>();

  editText(): void { this.text += 1; }

  changeReports(ids: readonly string[]): void {
    this.reports = new Map(ids.map((id) => [id, this.reports.get(id) ?? ++this.nextReport]));
  }

  capture(reportIds: readonly string[]): SubmittedDraftIdentity {
    this.changeReports(reportIds);
    return { text: this.text, reports: new Map(this.reports) };
  }

  remainingText(submitted: SubmittedDraftIdentity, current: string): string {
    return this.text === submitted.text ? '' : current;
  }

  remainingReports(submitted: SubmittedDraftIdentity, current: readonly string[]): string[] {
    this.changeReports(current);
    return current.filter((id) => submitted.reports.get(id) !== this.reports.get(id));
  }
}

/** Payloads cannot change during export; newly attached or edited evidence retains its identity. */
export function immutableEvidence<T>(items: readonly T[]): { payload: T[]; remaining(current: readonly T[]): T[] } {
  const identities = new Set(items);
  return { payload: structuredClone([...items]), remaining: (current) => current.filter((item) => !identities.has(item)) };
}

type Acceptance = { state: 'accepted' | 'absent'; session: PublicSession } | { state: 'unknown' };

/** HTTP rejection is not proof of rejection: append can succeed before scheduler activation fails. */
export async function reconcileMessageAcceptance(sessionUrl: string, messageId: string, request: typeof fetch = fetch): Promise<Acceptance> {
  try {
    const response = await request(sessionUrl, { cache: 'no-store' });
    const data = await response.json() as { session?: PublicSession };
    if (!response.ok || !data.session || !Array.isArray(data.session.messages)) return { state: 'unknown' };
    const accepted = data.session.messages.some((message) => message.role === 'user' && message.id === messageId);
    return { state: accepted ? 'accepted' : 'absent', session: data.session };
  } catch { return { state: 'unknown' }; }
}
