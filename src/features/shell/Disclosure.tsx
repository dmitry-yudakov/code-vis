'use client';

import type { ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';

/** Repeated expandable desktop settings/content section. */
export function Disclosure({ title, children, className, defaultExpanded = false, expanded, onChange }: {
  title: ReactNode; children: ReactNode; className?: string; defaultExpanded?: boolean;
  expanded?: boolean; onChange?(expanded: boolean): void;
}) {
  return <Accordion className={className} defaultExpanded={defaultExpanded} expanded={expanded}
    onChange={(_, next) => onChange?.(next)} disableGutters>
    <AccordionSummary expandIcon={<span aria-hidden="true">⌄</span>}>{title}</AccordionSummary>
    <AccordionDetails>{children}</AccordionDetails>
  </Accordion>;
}
