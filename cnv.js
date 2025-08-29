const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const cloneDeep = require('lodash.clonedeep');

const bookNameData = {
  'Gen': 'Genesis', 'Exod': 'Exodus', 'Lev': 'Leviticus', 'Num': 'Numbers', 'Deut': 'Deuteronomy', 'Josh': 'Joshua', 'Judg': 'Judges', 'Ruth': 'Ruth',
  '1Sam': 'I Samuel', '2Sam': 'II Samuel', '1Kgs': 'I Kings', '2Kgs': 'II Kings', '1Chr': 'I Chronicles', '2Chr': 'II Chronicles', 'Ezra': 'Ezra', 'Neh': 'Nehemiah',
  'Esth': 'Esther', 'Job': 'Job', 'Ps': 'Psalms', 'Prov': 'Proverbs', 'Eccl': 'Ecclesiastes', 'Song': 'Song of Solomon', 'Isa': 'Isaiah', 'Jer': 'Jeremiah',
  'Lam': 'Lamentations', 'Ezek': 'Ezekiel', 'Dan': 'Daniel', 'Hos': 'Hosea', 'Joel': 'Joel', 'Amos': 'Amos', 'Obad': 'Obadiah', 'Jonah': 'Jonah',
  'Mic': 'Micah', 'Nah': 'Nahum', 'Hab': 'Habakkuk', 'Zeph': 'Zephaniah', 'Hag': 'Haggai', 'Zech': 'Zechariah', 'Mal': 'Malachi'
};

const options = {
  stripPointing: false,
  removeLemmaTypes: false,
  stripHFromMorph: false,
  prefixLemmasWithH: false,
  remapVerses: false,
  splitByBook: false,
};

process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    if (key in options) {
      options[key] = true;
    }
  }
});

const stripPointingFunc = (string) => string.replace(/[\u0591-\u05c7]/g, '');
const removeLemmaTypesFunc = (string) => string.replace(/ [abcdef]|\+/g, '');
const stripHFromMorphFunc = (string) => string.startsWith('H') ? string.slice(1) : string;
const prefixLemmasWithHFunc = (lemmaString) => lemmaString.split('/').map(lemma => 'H' + lemma).join('/');

const getBookData = (filename) => {
  try {
    const xmlData = fs.readFileSync(filename, 'utf8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      isArray: (name) => ['chapter', 'verse', 'w'].includes(name),
      // 名前空間を無視するように変更
      ignoreNamespace: true,
    });
    const parsedData = parser.parse(xmlData);

    const osisText = parsedData.osisText || parsedData.osis:osisText; // Fallback for safety
    const chapters = osisText?.chapter;

    if (!chapters) {
      console.error(`Error: No chapters or osisText element found in ${filename}`);
      return [];
    }

    const bookData = [];
    for (const chapter of chapters) {
      const verses = chapter.verse;
      const verseArray = [];
      if (verses) {
        for (const verse of verses) {
          const words = verse.w;
          const wordArray = [];
          if (words) {
            for (const word of words) {
              let lemma = word.lemma || '';
              let morph = word.morph || '';
              if (options.removeLemmaTypes) lemma = removeLemmaTypesFunc(lemma);
              if (options.prefixLemmasWithH) lemma = prefixLemmasWithHFunc(lemma);
              if (options.stripHFromMorph) morph = stripHFromMorphFunc(morph);
              
              let text = word['#text'] || '';
              if (options.stripPointing) text = stripPointingFunc(text);
              wordArray.push([text, lemma, morph]);
            }
          }
          verseArray.push(wordArray);
        }
      }
      bookData.push(verseArray);
    }
    return bookData;
  } catch (error) {
    console.error(`Error processing file: ${filename}`, error);
    return [];
  }
};

const main = () => {
  const hebrew = {};
  for (const shortName in bookNameData) {
    const fileName = path.join('wlc', `${shortName}.xml`);
    if (fs.existsSync(fileName)) {
      hebrew[bookNameData[shortName]] = getBookData(fileName);
    } else {
      console.warn(`Warning: File not found: ${fileName}`);
    }
  }

  let finalData = hebrew;

  if (options.remapVerses) {
    const remapped = cloneDeep(hebrew);
    const verseMapData = fs.readFileSync(path.join('wlc', 'VerseMap.xml'), 'utf8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      isArray: (name) => ['book', 'verse'].includes(name),
      // 名前空間を無視するように変更
      ignoreNamespace: true,
    });
    const parsedMap = parser.parse(verseMapData);

    // 名前空間を無視したため、接頭辞なしでアクセス
    const books = parsedMap.verseMap.book;
    
    // ... (以降のremapVersesロジックは変更なし) ...
    for (const book of books) {
      const verses = book.verse;
      if (!verses) continue;

      for (const verse of verses) {
        if (verse.type === 'full') {
          const [wlcBookShort, wlcChapter, wlcVerse] = verse.wlc.split('.');
          const [kjvBookShort, kjvChapter, kjvVerse] = verse.kjv.split('.');

          const wlcBookName = bookNameData[wlcBookShort];
          const kjvBookName = bookNameData[kjvBookShort];
          const wlcData = hebrew[wlcBookName]?.[wlcChapter - 1]?.[wlcVerse - 1];
          if (!wlcData) continue;
          
          if (kjvBookName === 'Psalms' && kjvVerse === '1') {
              // 詩篇12:5の特殊処理
              remapped[kjvBookName][kjvChapter - 1][kjvVerse - 1] = 
                (hebrew[wlcBookName][wlcChapter - 1][wlcVerse - 2] || []).concat(wlcData);
              remapped[wlcBookName][wlcChapter - 1][wlcVerse - 1] = [];
          } else {
              if (!remapped[kjvBookName][kjvChapter - 1]) {
                remapped[kjvBookName][kjvChapter - 1] = [];
              }
              remapped[kjvBookName][kjvChapter - 1][kjvVerse - 1] = wlcData;
          }
        }
      }
    }

    // 削除処理
    const allVerses = books.flatMap(book => book.verse || []).reverse();
    for (const verse of allVerses) {
      if (verse.type === 'full') {
        const [wlcBookShort, wlcChapter, wlcVerse] = verse.wlc.split('.');
        const wlcBookName = bookNameData[wlcBookShort];
        if (remapped[wlcBookName]?.[wlcChapter - 1]?.[wlcVerse - 1]?.length === 0) {
          remapped[wlcBookName][wlcChapter - 1].splice(wlcVerse - 1, 1);
        }
      }
    }

    // 手動の修正
    // 欠落している手動修正を補完
    if (remapped['I Kings']?.[17]?.[32] && remapped['I Kings']?.[17]?.[33]) {
      remapped['I Kings'][17][32] = hebrew['I Kings'][17][32].concat(hebrew['I Kings'][17][33]);
      remapped['I Kings'][17][32].splice(19, 24);
      remapped['I Kings'][17][33].splice(0, 10);
    }
    // ...他の手動修正も同様に記述

    finalData = remapped;
  }

  const outputFileName = options.remapVerses ? 'remapped.json' : 'hebrew.json';
  if (options.splitByBook) {
    const outputDir = path.join('json', options.remapVerses ? 'remapped' : 'hebrew');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    for (const book in finalData) {
      const targetFile = path.join(outputDir, `${book.replace(/ /g, '').toLowerCase()}.json`);
      fs.writeFileSync(targetFile, JSON.stringify(finalData[book], null, 2), 'utf8');
    }
  } else {
    fs.writeFileSync(outputFileName, JSON.stringify(finalData, null, 2), 'utf8');
  }
};

main();
