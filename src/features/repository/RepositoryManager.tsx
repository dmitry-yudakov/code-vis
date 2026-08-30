'use client';

import { useMemo, useState } from 'react';
import type { CheckoutSummary, RepositoryBinding } from '@/shared/types';
import { createUuid } from '@/shared/uuid';

export function RepositoryManager({
  repositories,
  checkouts,
  hostId,
  selectedCheckoutId,
  disabled,
  onSelect,
  onChange,
}: {
  repositories: RepositoryBinding[];
  checkouts: CheckoutSummary[];
  hostId?: string;
  selectedCheckoutId?: string;
  disabled?: boolean;
  onSelect(checkoutId: string): void;
  onChange(update: (current: RepositoryBinding[]) => RepositoryBinding[]): void;
}) {
  const available = useMemo(() => {
    const bound = new Set(repositories.filter((item) => item.hostId === hostId).map((item) => item.checkoutId));
    return checkouts.filter((checkout) => !bound.has(checkout.id));
  }, [checkouts, hostId, repositories]);
  const [checkoutToAdd, setCheckoutToAdd] = useState('');
  const checkoutById = useMemo(() => new Map(checkouts.map((checkout) => [checkout.id, checkout])), [checkouts]);

  const move = (repositoryId: string, direction: -1 | 1) => {
    onChange((current) => {
      const index = current.findIndex((repository) => repository.id === repositoryId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <section className="repository-manager" aria-label="Session repositories">
      <div className="repository-manager-heading">
        <span className="eyebrow">Session repositories</span>
        <strong>{repositories.length || 'None'}</strong>
      </div>
      {repositories.length ? (
        <div className="repository-binding-list">
          {repositories.map((repository, index) => {
            const checkout = repository.hostId === hostId ? checkoutById.get(repository.checkoutId) : undefined;
            const name = checkout?.name || (repository.hostId === hostId ? 'Unavailable checkout' : 'Repository on another host');
            return (
              <div className={`repository-binding${repository.checkoutId === selectedCheckoutId ? ' selected' : ''}`} key={repository.id}>
                <button type="button" className="repository-binding-select" disabled={!checkout} onClick={() => onSelect(repository.checkoutId)}>
                  <strong>{name}</strong><small>{repository.role}</small>
                </button>
                <div className="repository-binding-actions">
                  <button type="button" title="Move up" aria-label={`Move ${name} up`} disabled={disabled || index === 0} onClick={() => move(repository.id, -1)}>↑</button>
                  <button type="button" title="Move down" aria-label={`Move ${name} down`} disabled={disabled || index === repositories.length - 1} onClick={() => move(repository.id, 1)}>↓</button>
                  <button type="button" title="Make primary" aria-label={`Make ${name} primary`} disabled={disabled || repository.role === 'primary'} onClick={() => onChange((current) => current.map((item) => ({
                    ...item,
                    role: item.id === repository.id ? 'primary' : 'reference',
                  })))}>★</button>
                  <button type="button" title="Remove" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => onChange((current) => current.filter((item) => item.id !== repository.id))}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="repository-manager-empty">Attach a repository to enable agent turns and working-tree views.</p>
      )}
      <div className="repository-add-row">
        <select aria-label="Repository to add" value={checkoutToAdd} disabled={disabled || !hostId || !available.length} onChange={(event) => setCheckoutToAdd(event.target.value)}>
          <option value="">{available.length ? 'Choose repository…' : 'No more repositories'}</option>
          {available.map((checkout) => <option value={checkout.id} key={checkout.id}>{checkout.name}</option>)}
        </select>
        <button type="button" disabled={disabled || !hostId || !checkoutToAdd} onClick={() => {
          const checkoutId = checkoutToAdd;
          const binding: RepositoryBinding = {
            id: createUuid(),
            hostId: hostId!,
            checkoutId,
            role: 'reference',
          };
          onChange((current) => current.some((repository) => (
            repository.hostId === binding.hostId && repository.checkoutId === binding.checkoutId
          )) ? current : [
            ...current,
            {
              ...binding,
              role: current.some((repository) => repository.role === 'primary') ? 'reference' : 'primary',
            },
          ]);
          onSelect(checkoutId);
          setCheckoutToAdd('');
        }}>Add</button>
      </div>
    </section>
  );
}
