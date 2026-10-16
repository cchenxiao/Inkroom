import type { Project } from '@/types/domain';
/** Only repair the untouched legacy demo project, never a customized work. */
export function migrateDemoWordTarget(saved: Project, seed: Project): Project {
  const oldDefault = { ...seed, targetWords: 180_000 };
  return Object.entries(oldDefault).every(([key, value]) => saved[key as keyof Project] === value)
    ? { ...saved, targetWords: seed.targetWords }
    : saved;
}
