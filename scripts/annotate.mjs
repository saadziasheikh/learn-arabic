#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORIES_DIR = path.join(ROOT, 'stories');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(ROOT, 'cache');
const CACHE_PATH = path.join(CACHE_DIR, 'words.json');

const MODEL = process.env.ANNOTATE_MODEL || 'claude-sonnet-4-6';
const BATCH_SIZE = 60;
const ARABIC_WORD = /[ء-غف-يً-ْ]+/g;

const SYSTEM_PROMPT = `You are an Arabic-to-English word annotator for an Arabic-learning website.

For each Arabic word given, output ONE line in this exact format:
<arabic word> - <english meaning> - <extra info>

Where <extra info> depends on the part of speech:
- Verb: "<past form> | <present form> - Form X (template)" where X is I, II, III, IV, V, VI, VII, VIII, IX, or X
- Noun: the singular form if the word is plural, OR the plural form if the word is singular
- Everything else (adjectives, particles, prepositions, pronouns, etc.): omit the extra info entirely (just "<arabic word> - <english meaning>")

Rules:
- Do not mention masculine, feminine, singular, plural, or any other grammar tags.
- Keep the Arabic word with its original harakat (vowels) as much as possible.
- Output exactly one line per input word, in the same order.
- Do not number the lines, do not add explanations, do not add a header or footer.
- If a word has leading particles like وَ, فَ, بِ, لِ, كَ — annotate the whole surface form as given (do not strip them).

Examples:
كَانَ - Was - كَانَ | يَكُونُ - Form I (فَعَلَ)
أَحْمَدُ - Ahmad
وَلَدًا - A boy - أَوْلَادٌ
ذَكِيًّا - Intelligent
قَبَائِلُ - Tribes - قَبِيلَةٌ
فَتَحَ - Opened - فَتَحَ | يَفْتَحُ - Form I (فَعَلَ)
فِي - In
عَلَى - On`;

const client = new Anthropic();

function tokenize(text) {
  return [...text.matchAll(ARABIC_WORD)].map(m => m[0]);
}

function deriveTitle(filename) {
  return filename
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

function saveCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function annotateBatch(words) {
  const list = words.map(w => `- ${w}`).join('\n');
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Annotate these ${words.length} Arabic words. Output one line per word in the same order, no numbering, no extra text:\n\n${list}`,
      },
    ],
  });
  const text = msg.content.map(b => b.text || '').join('');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {};
  // First pass: zip by index (assume order preserved)
  if (lines.length === words.length) {
    for (let i = 0; i < words.length; i++) {
      if (lines[i].startsWith(words[i])) {
        result[words[i]] = lines[i];
      }
    }
  }
  // Fallback: prefix-match for any missing
  for (const w of words) {
    if (result[w]) continue;
    const match = lines.find(l => l.startsWith(w + ' ') || l.startsWith(w + '-'));
    if (match) result[w] = match;
  }
  return result;
}

async function processStory(storyPath, cache) {
  const id = path.basename(storyPath);
  const text = fs.readFileSync(storyPath, 'utf8');
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const allWords = new Set();
  for (const p of paragraphs) for (const w of tokenize(p)) allWords.add(w);

  const missing = [...allWords].filter(w => !cache[w]);
  console.log(`[${id}] ${allWords.size} unique words (${missing.length} need annotation)`);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const n = Math.floor(i / BATCH_SIZE) + 1;
    const total = Math.ceil(missing.length / BATCH_SIZE);
    process.stdout.write(`  batch ${n}/${total} (${batch.length} words)... `);
    const annotated = await annotateBatch(batch);
    Object.assign(cache, annotated);
    saveCache(cache);
    const got = Object.keys(annotated).length;
    console.log(`got ${got}/${batch.length}`);
  }

  const words = {};
  for (const w of allWords) {
    if (cache[w]) words[w] = cache[w];
  }

  const out = { id, title: deriveTitle(id), paragraphs, words };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(out, null, 2));
  console.log(`  wrote data/${id}.json`);
  return out;
}

function buildIndex() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f !== 'index.json');
  const index = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    return { id: data.id, title: data.title };
  });
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`wrote data/index.json (${index.length} stories)`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const targets = args.length > 0
    ? args.map(a => path.resolve(a))
    : fs.readdirSync(STORIES_DIR)
        .map(f => path.join(STORIES_DIR, f))
        .filter(p => fs.statSync(p).isFile());

  const cache = loadCache();
  for (const t of targets) {
    await processStory(t, cache);
  }
  buildIndex();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
