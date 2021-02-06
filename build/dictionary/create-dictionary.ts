import { getName } from '@cospired/i18n-iso-languages';
import { orderBy } from 'lodash';
import { log } from '../issue-logging';
import { Language } from '../language';
import { Metadata } from '../lookups/metadata';
import { WordPronunciation } from '../pronunciation-sources.ts/pronunciation-source';
import { DefaultMap } from '../utils/default-map';
import {
  Distributions,
  MissingMetadataIssue,
} from './dictionary-creation-issues';
import { normalizeWordPronunciation } from './normalization';
import { knownMetadataByLanguage } from '../lookups/metadata';
import { englishCollator, getCollator } from '../utils/collation';
import { getPhoibleData } from './phoible';
import { ipaSymbols } from '../lookups/ipa-symbols';

export interface Dictionary {
  data: Map<string, string[]>;
  metadata: Metadata;
}

export async function createDictionary(
  language: Language,
  wordPronunciations: WordPronunciation[],
): Promise<Dictionary> {
  const metadata = await getMetadata(language, wordPronunciations);

  const pronunciationsByWord = new DefaultMap<string, Set<string>>(
    () => new Set(),
  );
  for (const wordPronunciation of wordPronunciations) {
    const normalizedWordPronunciations = normalizeWordPronunciation(
      wordPronunciation,
      metadata,
    );
    for (const normalizedWordPronunciation of normalizedWordPronunciations) {
      pronunciationsByWord
        .getOrCreate(normalizedWordPronunciation.word)
        .add(normalizedWordPronunciation.pronunciation);
    }
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

async function getMetadata(
  language: Language,
  wordPronunciations: WordPronunciation[],
): Promise<Metadata> {
  const knownMetadata = knownMetadataByLanguage.get(language);
  if (knownMetadata) return knownMetadata;

  const { metadata, distributions } = generateDummyMetadataAndDistributions(
    language,
    wordPronunciations,
  );
  const phoibleData = await getPhoibleData();
  log(
    new MissingMetadataIssue(
      metadata,
      distributions,
      phoibleData.getOrCreate(language),
    ),
  );
  return metadata;
}

function generateDummyMetadataAndDistributions(
  language: Language,
  wordPronunciations: WordPronunciation[],
) {
  const description = getName(language, 'en') ?? language;

  const graphemeStats = getCharacterStats(
    (function* () {
      const words = new Set(
        [...wordPronunciations].map(wordPronunciation =>
          wordPronunciation.word.toLocaleLowerCase(language),
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
        const phonemes = [...wordPronunciation.pronunciation].filter(phoneme =>
          ipaSymbols.has(phoneme),
        );
        yield* phonemes;
      }
    })(),
  );

  const metadata: Metadata = {
    language,
    description,
    graphemes: graphemeStats.characters,
    phonemes: phonemeStats.characters,
    graphemeReplacements: [],
    phonemeReplacements: [],
  };

  const distributions: Distributions = {
    graphemeDistribution: graphemeStats.distribution,
    phonemeDistribution: phonemeStats.distribution,
  };

  return { metadata, distributions };
}

function getCharacterStats(characters: Iterable<string>) {
  const characterCounts = new DefaultMap<string, number>(() => 0);
  let totalCharacterCount = 0;
  for (const character of characters) {
    characterCounts.set(character, characterCounts.getOrCreate(character) + 1);
    totalCharacterCount++;
  }
  const sortedCharacterCounts = orderBy(
    [...characterCounts],
    ([character, count]) => count,
    'desc',
  );
  return {
    characters: sortedCharacterCounts.map(([character, count]) => character),
    distribution: new Map(
      sortedCharacterCounts.map(([character, count]) => [
        character,
        count / totalCharacterCount,
      ]),
    ),
  };
}
