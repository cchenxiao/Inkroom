import { expect, it } from 'vitest';
import { newBibleEntry } from './draft';
import type { Character, Foreshadow, InfoState } from '@/types/domain';
it('creates a complete character candidate with voice and fact maps', () => {
  const item = newBibleEntry('characters', 'ch7') as unknown as Character;
  expect(item.voice.radar).toHaveLength(5);
  expect(item.knows).toEqual({});
  expect(item.hardTraits).toEqual({});
  expect(item.locked).toBe(false);
});
it('keeps new information and foreshadows tied to the current chapter', () => {
  expect((newBibleEntry('info', 'ch7') as unknown as InfoState).disclosedChapter).toBe('ch7');
  expect((newBibleEntry('foreshadows', 'ch7') as unknown as Foreshadow).status).toBe('open');
});
