import type { StyleStats } from '../../types/domain';

/** Sentence measurements count letters and numerals; punctuation and spacing are excluded. */
const characterCount = (value: string) => [...value.replace(/[^\p{L}\p{N}]/gu, '')].length;
export function measureStyle(text: string, bannedWords: string[]): StyleStats {
  const sentenceLengths = text
    .split(/[。！？!?；;\n]+/u)
    .map(characterCount)
    .filter(Boolean);
  const total = characterCount(text);
  const dialogue = [...text.matchAll(/[“「『"]([^”」』"]*)[”」』"]/gu)].reduce(
    (sum, match) => sum + characterCount(match[1]),
    0,
  );
  const repeatedPhrases = bannedWords.filter((phrase) => text.includes(phrase));
  return {
    sentenceLengths,
    dialogueRatio: total ? Number((dialogue / total).toFixed(3)) : 0,
    aiTaste: Number(Math.min(0.95, 0.09 + repeatedPhrases.length * 0.16).toFixed(2)),
    repeatedPhrases,
  };
}
export function sentenceDistribution(lengths: number[]) {
  const ranges = ['1–10 字', '11–20 字', '21–30 字', '31–40 字', '40 字以上'];
  return ranges.map((range, index) => ({
    range,
    count: lengths.filter((length) =>
      index === 4 ? length > 40 : length > index * 10 && length <= (index + 1) * 10,
    ).length,
  }));
}
