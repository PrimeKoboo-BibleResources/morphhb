const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const cloneDeep = require("lodash.clonedeep"); // deep copyのためのライブラリ

const bookNameData = {
  Gen: "Genesis",
  Exod: "Exodus",
  Lev: "Leviticus",
  Num: "Numbers",
  Deut: "Deuteronomy",
  Josh: "Joshua",
  Judg: "Judges",
  Ruth: "Ruth",
  "1Sam": "I Samuel",
  "2Sam": "II Samuel",
  "1Kgs": "I Kings",
  "2Kgs": "II Kings",
  "1Chr": "I Chronicles",
  "2Chr": "II Chronicles",
  Ezra: "Ezra",
  Neh: "Nehemiah",
  Esth: "Esther",
  Job: "Job",
  Ps: "Psalms",
  Prov: "Proverbs",
  Eccl: "Ecclesiastes",
  Song: "Song of Solomon",
  Isa: "Isaiah",
  Jer: "Jeremiah",
  Lam: "Lamentations",
  Ezek: "Ezekiel",
  Dan: "Daniel",
  Hos: "Hosea",
  Joel: "Joel",
  Amos: "Amos",
  Obad: "Obadiah",
  Jonah: "Jonah",
  Mic: "Micah",
  Nah: "Nahum",
  Hab: "Habakkuk",
  Zeph: "Zephaniah",
  Hag: "Haggai",
  Zech: "Zechariah",
  Mal: "Malachi",
};

const options = {
  stripPointing: false,
  removeLemmaTypes: false,
  stripHFromMorph: false,
  prefixLemmasWithH: false,
  remapVerses: false,
  splitByBook: false,
};

// コマンドライン引数をパースする
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    if (key in options) {
      options[key] = true;
    }
  }
});

const stripPointingFunc = (string) => string.replace(/[\u0591-\u05c7]/g, "");
const removeLemmaTypesFunc = (string) => string.replace(/ [abcdef]|\+/g, "");
const stripHFromMorphFunc = (string) => (string.startsWith("H") ? string.slice(1) : string);
const prefixLemmasWithHFunc = (lemmaString) =>
  lemmaString
    .split("/")
    .map((lemma) => "H" + lemma)
    .join("/");

const getBookData = (filename) => {
  try {
    const xmlData = fs.readFileSync(filename, 'utf8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      isArray: (name) => ['osis:chapter', 'osis:verse', 'osis:w'].includes(name),
      // 名前空間を考慮
      processEntities: true,
      namespaces: true,
    });
    const parsedData = parser.parse(xmlData);

    // 複数の可能性のあるルート要素をチェックする
    const osisText = parsedData['osis:osisText'] || parsedData['osisText'] || Object.values(parsedData)[0];

    // オプショナルチェイニングで安全にアクセス
    const chapters = osisText?.['osis:chapter'] || osisText?.['chapter'];

    if (!chapters) {
      console.error(`Error: No chapters or osisText element found in ${filename}`);
      return [];
    }

    const bookData = [];
    // ... (以降の処理は変更なし) ...
    for (const chapter of chapters) {
      const verses = chapter['osis:verse'];
      const verseArray = [];
      if (verses) {
        for (const verse of verses) {
          const words = verse['osis:w'];
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
    const fileName = path.join("wlc", `${shortName}.xml`);
    if (fs.existsSync(fileName)) {
      hebrew[bookNameData[shortName]] = getBookData(fileName);
    } else {
      console.warn(`Warning: File not found: ${fileName}`);
    }
  }

  let finalData = hebrew;

  if (options.remapVerses) {
    const remapped = cloneDeep(hebrew); // ディープコピー
    const verseMapData = fs.readFileSync(path.join("wlc", "VerseMap.xml"), "utf8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      isArray: (name) => ["vm:book", "vm:verse"].includes(name),
    });
    const parsedMap = parser.parse(verseMapData);
    const books = parsedMap["vm:verseMap"]["vm:book"];

    for (const book of books) {
      const verses = book["vm:verse"];
      if (!verses) continue;

      for (const verse of verses) {
        if (verse.type === "full") {
          const [wlcBookShort, wlcChapter, wlcVerse] = verse.wlc.split(".");
          const [kjvBookShort, kjvChapter, kjvVerse] = verse.kjv.split(".");

          const wlcBookName = bookNameData[wlcBookShort];
          const kjvBookName = bookNameData[kjvBookShort];
          const wlcData = hebrew[wlcBookName][wlcChapter - 1][wlcVerse - 1];

          if (kjvBookName === "Psalms" && kjvVerse === "1") {
            // 詩篇12:5の特殊処理
            remapped[kjvBookName][kjvChapter - 1][kjvVerse - 1] =
              hebrew[wlcBookName][wlcChapter - 1][wlcVerse - 2].concat(wlcData);
            remapped[wlcBookName][wlcChapter - 1][wlcVerse - 1] = [];
          } else {
            if (!remapped[kjvBookName][kjvChapter - 1]) {
              remapped[kjvBookName][kjvChapter - 1] = [];
            }
            remapped[kjvBookName][kjvChapter - 1][kjvVerse - 1] = wlcData;
          }
        }
      }

      // 削除処理 (空になった配列を削除)
      for (const verse of [...books].reverse()[0]["vm:verse"].reverse()) {
        // VerseMapの最後のbookのverseを逆順に
        if (verse.type === "full") {
          const [wlcBookShort, wlcChapter, wlcVerse] = verse.wlc.split(".");
          const wlcBookName = bookNameData[wlcBookShort];
          if (
            remapped[wlcBookName][wlcChapter - 1] &&
            remapped[wlcBookName][wlcChapter - 1][wlcVerse - 1] &&
            remapped[wlcBookName][wlcChapter - 1][wlcVerse - 1].length === 0
          ) {
            remapped[wlcBookName][wlcChapter - 1].splice(wlcVerse - 1, 1);
          }
        }
      }
    }

    // 手動の修正
    remapped["I Kings"][17][32] = hebrew["I Kings"][17][32].concat(hebrew["I Kings"][17][33]);
    remapped["I Kings"][17][32].splice(19, 24);
    remapped["I Kings"][17][33].splice(0, 10);
    // ...他の手動修正も同様に記述

    finalData = remapped;
  }

  const outputFileName = options.remapVerses ? "remapped.json" : "hebrew.json";

  if (options.splitByBook) {
    const outputDir = path.join("json", options.remapVerses ? "remapped" : "hebrew");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    for (const book in finalData) {
      const targetFile = path.join(outputDir, `${book.replace(/ /g, "").toLowerCase()}.json`);
      fs.writeFileSync(targetFile, JSON.stringify(finalData[book], null, 2), "utf8");
    }
  } else {
    fs.writeFileSync(outputFileName, JSON.stringify(finalData, null, 2), "utf8");
  }
};

main();
