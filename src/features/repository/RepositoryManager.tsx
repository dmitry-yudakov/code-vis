'use client';

import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import NativeSelect from '@mui/material/NativeSelect';

import { Disclosure } from '@/features/shell/Disclosure';
import { useMemo, useState } from 'react';
import type { CheckoutSummary, RepositoryBinding } from '@/shared/types';
import { createUuid } from '@/shared/uuid';
import { WORKTREE_FIXED_BINDING } from '@/features/conversation/worktreeChoice';

export function RepositoryManager({
  repositories,
  checkouts,
  hostId,
  selectedCheckoutId,
  disabled,
  fixedWorktree,
  onSelect,
  onChange,
}: {
  repositories: RepositoryBinding[];
  checkouts: CheckoutSummary[];
  hostId?: string;
  selectedCheckoutId?: string;
  disabled?: boolean;
  fixedWorktree?: boolean;
  onSelect(checkoutId: string): void;
  onChange(update: (current: RepositoryBinding[]) => RepositoryBinding[]): void;
}) {
  const available = useMemo(() => {
    const bound = new Set(repositories.filter((item) => item.hostId === hostId).map((item) => item.checkoutId));
    return checkouts.filter((checkout) => !checkout.worktree && !bound.has(checkout.id));
  }, [checkouts, hostId, repositories]);
  const [checkoutToAdd, setCheckoutToAdd] = useState('');
  // One repository needs no managing to read its changes; none or several is when this list is the way in.
  const [open, setOpen] = useState(repositories.length !== 1);
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
      {fixedWorktree && <p>{WORKTREE_FIXED_BINDING}</p>}
      <Disclosure expanded={open} onChange={setOpen} title={<span className="repository-manager-heading">
        <span>Session repositories</span><strong>{repositories.length || 'None'}</strong>
      </span>}>
        {repositories.length ? (
          <div className="repository-binding-list">
            {repositories.map((repository, index) => {
              const checkout = repository.hostId === hostId ? checkoutById.get(repository.checkoutId) : undefined;
              const name = checkout?.name || (repository.hostId === hostId ? 'Unavailable checkout' : 'Repository on another host');
              return (
                <Paper className={`repository-binding${repository.checkoutId === selectedCheckoutId ? ' selected' : ''}`} key={repository.id}>
                  <ButtonBase type="button" className="repository-binding-select" disabled={!checkout} onClick={() => onSelect(repository.checkoutId)}>
                    <strong>{name}</strong><small>{repository.role}</small>
                  </ButtonBase>
                  <div className="repository-binding-actions">
                    <IconButton type="button" title="Move up" aria-label={`Move ${name} up`} disabled={disabled || index === 0} onClick={() => move(repository.id, -1)}>↑</IconButton>
                    <IconButton type="button" title="Move down" aria-label={`Move ${name} down`} disabled={disabled || index === repositories.length - 1} onClick={() => move(repository.id, 1)}>↓</IconButton>
                    <IconButton type="button" title="Make primary" aria-label={`Make ${name} primary`} disabled={disabled || repository.role === 'primary'} onClick={() => onChange((current) => current.map((item) => ({
                      ...item,
                      role: item.id === repository.id ? 'primary' : 'reference',
                    })))}>★</IconButton>
                    <IconButton type="button" title="Remove" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => onChange((current) => current.filter((item) => item.id !== repository.id))}>×</IconButton>
                  </div>
                </Paper>
              );
            })}
          </div>
        ) : (
          <p className="repository-manager-empty">Attach a repository to enable agent turns and working-tree views.</p>
        )}
        <div className="repository-add-row">
          <NativeSelect value={checkoutToAdd} disabled={disabled || !hostId || !available.length} onChange={(event) => setCheckoutToAdd(event.target.value)} inputProps={{ "aria-label": "Repository to add" }}>
            <option value="">{available.length ? 'Choose repository…' : 'No more repositories'}</option>
            {available.map((checkout) => <option value={checkout.id} key={checkout.id}>{checkout.name}</option>)}
          </NativeSelect>
          <Button type="button" disabled={disabled || !hostId || !checkoutToAdd} onClick={() => {
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
          }}>Add</Button>
        </div>
      </Disclosure>
    </section>
  );
}
