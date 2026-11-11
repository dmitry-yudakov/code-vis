import type { AppConfig } from '@/server/config';
import type { DurableProject } from '@/shared/types';
import { getCheckoutRegistry } from './checkoutRegistry';
import { readRepositoryImage, RepositoryFileError } from './repositoryFiles';

export async function readProjectLogo(project: DurableProject, hostId: string, config: AppConfig) {
  const logo = project.logo;
  if (!logo) throw new RepositoryFileError('This project has no logo.', 404);
  const binding = project.repositories.find(repository => repository.id === logo.repositoryId && repository.hostId === hostId);
  if (!binding) throw new RepositoryFileError('Choose a repository on this project’s machine.');
  const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(binding.checkoutId);
  return readRepositoryImage(checkout.realPath, logo.path);
}
