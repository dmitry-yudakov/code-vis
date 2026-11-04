'use client';

import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import NativeSelect from '@mui/material/NativeSelect';

import { DesktopPopover } from '@/features/shell/DesktopPopover';
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
  const checkoutById = useMemo(() => new Map(checkouts.map((checkout) => [checkout.id, checkout])), [checkouts]);
  const repositoryName = (repository: RepositoryBinding) => repository.hostId === hostId
    ? checkoutById.get(repository.checkoutId)?.name || 'Unavailable checkout'
    : 'Repository on another host';

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

  const form = (
    <section className="repository-manager" aria-label="Session repositories">
      {fixedWorktree && <p>{WORKTREE_FIXED_BINDING}</p>}
      <strong className="repository-manager-heading">Repositories</strong>
      {repositories.length ? (
        <div className="repository-binding-list">
          {repositories.map((repository, index) => {
            const checkout = repository.hostId === hostId ? checkoutById.get(repository.checkoutId) : undefined;
            const name = repositoryName(repository);
            return (
              <Paper className={`repository-binding${repository.checkoutId === selectedCheckoutId ? ' selected' : ''}`} key={repository.id}>
                <ButtonBase type="button" className="repository-binding-select" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', px: 1 }} disabled={!checkout} onClick={() => onSelect(repository.checkoutId)}>
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
    </section>
  );

  if (!repositories.length) return form;
  const selected = repositories.find(repository => repository.hostId === hostId && repository.checkoutId === selectedCheckoutId);
  const selectedName = selected ? repositoryName(selected) : 'No repository selected';
  return <div className="repository-context-row">
    {repositories.length > 1 ? <NativeSelect value={selectedCheckoutId || ''}
      onChange={event => onSelect(event.target.value)} inputProps={{ 'aria-label': 'Current repository' }}>
      {repositories.map(repository => <option key={repository.id} value={repository.checkoutId}
        disabled={repository.hostId !== hostId || !checkoutById.has(repository.checkoutId)}>
        {repositoryName(repository)}{repository.role === 'primary' ? ' (primary)' : ''}
      </option>)}
    </NativeSelect> : <strong className="repository-name" title={selectedName}>{selectedName}</strong>}
    <DesktopPopover className="repository-manage-picker" label="Manage repositories" summary={<span aria-hidden="true">＋</span>}
      icon placement="bottom-end" width={360}>
      {() => form}
    </DesktopPopover>
  </div>;
}
