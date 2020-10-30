import { createStream as createXmlStream } from 'sax';
import { createReadStream, statSync } from 'fs-extra';
import streamProgressbar from 'stream-progressbar';
import { isEqual } from 'lodash';
import { Edition } from './editions';
import { Page, PageParser, ParseResult } from './page-parser';
import { getWiktionaryXmlFilePath } from './wiktionary-download';
import { parseGerman } from './page-parser-de';

const pageParsers: { [edition in Edition]: PageParser<edition> } = {
  'de': parseGerman,
  'en': () => ([]), // TODO: Implement
} as const;

export async function parseWiktionaryEdition<TEdition extends Edition>(edition: TEdition): Promise<ParseResult[]> {
  const parsePage = pageParsers[edition] as PageParser<TEdition>;

  const xmlStream = createXmlStream(/* strict: */ true);
  const openTags: string[] = []; // A stack of all open tags
  let currentTitle: string | null = null;
  const parseResults: ParseResult[] = [];

  xmlStream.on('opentag', tag => openTags.push(tag.name));

  xmlStream.on('closetag', () => openTags.pop());

  xmlStream.on('text', text => {
    if (isEqual(openTags, ['mediawiki', 'page', 'title'])) {
      currentTitle = text;
    } else if (isEqual(openTags, ['mediawiki', 'page', 'revision', 'text'])) {
      if (!currentTitle) return;
      if (currentTitle.includes(':')) return; // special page
      if (currentTitle.includes(' ')) return; // multi-word entry

      const page: Page<TEdition> = { edition: edition, name: currentTitle, text };
      for (const result of parsePage(page)) {
        parseResults.push(result);
      }
    }
  });

  const xmlFilePath = await getWiktionaryXmlFilePath(edition);
  const fileStream = createReadStream(xmlFilePath);

  fileStream
    .pipe(streamProgressbar(':bar :percent parsed (:etas remaining)', { total: statSync(xmlFilePath).size }))
    .pipe(xmlStream);

  await new Promise((resolve, reject) => fileStream.on('close', resolve).on('error', reject));

  return parseResults;
}
