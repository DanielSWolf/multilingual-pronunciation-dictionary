import { getName } from '@cospired/i18n-iso-languages';
import { orderBy, pick } from 'lodash';
import { log } from '../issue-logging';
import { Language } from '../language';
import { WordPronunciation } from '../pronunciation-sources.ts/pronunciation-source';
import { DefaultMap } from '../utils/default-map';
import { MissingMetadataIssue } from './dictionary-creation-issues';

export interface Dictionary {
  data: Map<string, string[]>;
  metadata: Metadata;
}

export interface Metadata {
  language: Language;
  description: string;
  graphemes: string[];
  phonemes: string[];
  graphemeReplacements: Partial<Record<string, string>>;
  phonemeReplacements: Partial<Record<string, string>>;
}

export interface Frequencies {
  graphemeFrequencies: Map<string, number>;
  phonemeFrequencies: Map<string, number>;
}

const knownMetadataLookup = new Map<Language, Metadata>();

const unsupportedLanguages: Language[] = [
  // Dead languages
  'la', // Latin

  // Languages with too many graphemes
  'ja', // Japanese
  'zh', // Chinese
  'ko', // Korean
];

export function createDictionary(
  language: Language,
  wordPronunciations: WordPronunciation[],
): Dictionary | null {
  if (unsupportedLanguages.includes(language)) return null;

  const metadata = getMetadata(language, wordPronunciations);

  const pronunciationsByWord = new DefaultMap<string, string[]>(() => []);
  for (const wordPronunciation of wordPronunciations) {
    pronunciationsByWord
      .get(wordPronunciation.word)
      .push(wordPronunciation.pronunciation);
  }

  const languageCollator = getCollator(language);
  const sortedWords = [...pronunciationsByWord.keys()].sort(
    languageCollator.compare,
  );
  const data = new Map<string, string[]>(
    sortedWords.map(word => {
      const pronunciations = pronunciationsByWord.get(word)!;
      const sortedPronunciations = [...pronunciations].sort(
        englishCollator.compare,
      );
      return [word, sortedPronunciations];
    }),
  );

  return { data, metadata };
}

function getMetadata(
  language: Language,
  wordPronunciations: WordPronunciation[],
): Metadata {
  const knownMetadata = knownMetadataLookup.get(language);
  if (knownMetadata) return knownMetadata;

  const { metadata, frequencies } = generateDummyMetadataAndFrequencies(
    language,
    wordPronunciations,
  );
  log(new MissingMetadataIssue(metadata, frequencies));
  return metadata;
}

function generateDummyMetadataAndFrequencies(
  language: Language,
  wordPronunciations: WordPronunciation[],
) {
  const description = getName(language, 'en') ?? language;

  const graphemeStats = getCharacterStats(
    (function* () {
      const words = new Set(
        [...wordPronunciations].map(
          wordPronunciation => wordPronunciation.word,
        ),
      );
      for (const word of words) {
        const graphemes = [...word];
        yield* graphemes;
      }
    })(),
  );

  const phonemeStats = getCharacterStats(
    (function* () {
      for (const wordPronunciation of wordPronunciations) {
        const phonemes = [...wordPronunciation.pronunciation];
        yield* phonemes;
      }
    })(),
  );

  const metadata: Metadata = {
    language,
    description,
    graphemes: graphemeStats.characters,
    phonemes: phonemeStats.characters,
    graphemeReplacements: {},
    phonemeReplacements: {},
  };

  const frequencies: Frequencies = {
    graphemeFrequencies: graphemeStats.frequencies,
    phonemeFrequencies: phonemeStats.frequencies,
  };

  return { metadata, frequencies };
}

const englishCollator = new Intl.Collator();

function getCollator(language: string) {
  try {
    return new Intl.Collator(language);
  } catch {
    // Ignore invalid language codes
    return englishCollator;
  }
}

function getCharacterStats(characters: Iterable<string>) {
  const characterCounts = new DefaultMap<string, number>(() => 0);
  let totalCharacterCount = 0;
  for (const character of characters) {
    characterCounts.set(character, characterCounts.get(character) + 1);
    totalCharacterCount++;
  }
  const sortedCharacterCounts = orderBy(
    [...characterCounts],
    ([character, count]) => count,
    'desc',
  );
  return {
    characters: sortedCharacterCounts.map(([character, count]) => character),
    frequencies: new Map(
      sortedCharacterCounts.map(([character, count]) => [
        character,
        count / totalCharacterCount,
      ]),
    ),
  };
}