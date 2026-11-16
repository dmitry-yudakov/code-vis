import { z } from 'zod';

/** A file identity only; opening a tab never attaches its contents. */
export const activeFileContextSchema = z.object({
  checkoutId: z.string().min(1).max(128).regex(/^[^/\\\u0000-\u001f\u007f]+$/),
  path: z.string().min(1).max(4096).regex(/^[^\\\u0000-\u001f\u007f]+$/)
    .refine(value => !value.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')),
  view: z.enum(['file', 'diff']),
}).strict();

export type ActiveFileContext = z.infer<typeof activeFileContextSchema>;
