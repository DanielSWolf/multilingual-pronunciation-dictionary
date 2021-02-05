import { nonEssentialIpaSymbols } from '../lookups/ipa-symbols';
import { log } from '../issue-logging';
import { WordPronunciation } from '../pronunciation-sources.ts/pronunciation-source';
import { Metadata } from '../lookups/metadata';
import {
  InvalidGraphemeInWordIssue,
  InvalidPhonemeInPronunciationIssue,
} from './dictionary-creation-issues';

export function normalizeWordPronunciation(
  wordPronunciation: WordPronunciation,
  metadata: Metadata,
): WordPronunciation[] {
  const word = normalizeWord(wordPronunciation, metadata);
  if (word === null) return [];

  const pronunciations = normalizePronunciation(wordPronunciation, metadata);
  return pronunciations.map(pronunciation => ({
    sourceEdition: wordPronunciation.sourceEdition,
    language: wordPronunciation.language,
    word,
    pronunciation,
  }));
}

export function normalizeWord(
  wordPronunciation: WordPronunciation,
  metadata: Metadata,
): string | null {
  // Convert to lower case, honoring any language-specific rules
  let normalized = wordPronunciation.word.toLocaleLowerCase(metadata.language);

  // Apply replacements
  for (const [regex, newValue] of metadata.graphemeReplacements ?? []) {
    normalized = normalized.replaceAll(regex, newValue);
  }

  // Check that the result consists only of valid graphemes
  const invalidGrapheme = [...normalized].find(
    grapheme => !metadata.graphemes.includes(grapheme),
  );
  if (invalidGrapheme) {
    log(
      new InvalidGraphemeInWordIssue(
        wordPronunciation,
        normalized,
        invalidGrapheme,
        metadata,
      ),
    );
    return null;
  }

  return normalized;
}

export function normalizePronunciation(
  wordPronunciation: WordPronunciation,
  metadata: Metadata,
): string[] {
  // Remove surrounding /.../ and [...]
  let normalized = wordPronunciation.pronunciation;
  if (
    (normalized.startsWith('/') && normalized.endsWith('/')) ||
    (normalized.startsWith('[') && normalized.endsWith(']'))
  ) {
    normalized = normalized.substring(1, normalized.length - 1);
  }

  // Remove all non-essential symbols
  normalized = [...normalized]
    .filter(char => !nonEssentialIpaSymbols.has(char))
    .join('');

  // Apply replacements
  for (const [regex, newValue] of metadata.phonemeReplacements ?? []) {
    normalized = normalized.replaceAll(regex, newValue);
  }

  // Handle alternatives
  const alternatives = getAlternatives(normalized);

  // Check that all alternatives consist only of valid phonemes
  const validAlternatives = alternatives.filter(alternative => {
    const invalidPhoneme = [...alternative].find(
      phoneme => !metadata.phonemes.includes(phoneme),
    );
    if (invalidPhoneme) {
      log(
        new InvalidPhonemeInPronunciationIssue(
          wordPronunciation,
          invalidPhoneme,
          metadata,
        ),
      );
      return false;
    }
    return true;
  });

  return validAlternatives;
}

function getAlternatives(string: string): string[] {
  const optionalRegex = /\((.*?)\)/g;
  const minimalVersion = string.replaceAll(optionalRegex, '');
  const maximalVersion = string.replaceAll(optionalRegex, '$1');
  return minimalVersion === maximalVersion
    ? [minimalVersion]
    : [minimalVersion, maximalVersion];
}