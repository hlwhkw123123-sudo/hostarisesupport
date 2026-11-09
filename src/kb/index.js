// Knowledge Base Engine (Milestone 5).
//
// Loads Markdown docs from a directory, ranks them by simple term overlap,
// and serves individual docs by id. Nothing here is treated as verified
// Hostarise policy unless the doc itself says so: every doc carries a
// front-matter-like `verified: true/false` line (default false) and the
// `verified` flag is exposed on every doc and search result.
//
// All file reads stay inside the KB directory (see safeJoin in
// src/security.js). Paths that escape the directory are rejected.
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeJoin } from '../security.js';

const SNIPPET_LENGTH = 200;
const TITLE_WEIGHT = 3;
const CONTENT_WEIGHT = 1;

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()"'`\-–—/\\[\]{}<>]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + needle.length;
  }
}

function parseDoc(raw, id, absPath) {
  const lines = raw.split('\n');

  // First '# ' heading is the title; fall back to the file name.
  let title = null;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
      break;
    }
  }
  if (!title) title = path.basename(id, '.md');

  // Front-matter-like `verified: true/false` line near the top of the file
  // (before the first heading, or within the first 10 lines). Default false.
  let verified = false;
  for (let i = 0; i < Math.min(lines.length, 10); i += 1) {
    const m = lines[i].match(/^\s*verified:\s*(true|false)\s*$/i);
    if (m) {
      verified = m[1].toLowerCase() === 'true';
      break;
    }
    if (lines[i].startsWith('# ')) break;
  }

  return { id, title, path: absPath, content: raw, verified };
}

async function discover(dir, base) {
  const docs = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      docs.push(...(await discover(abs, base)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const rel = path.relative(base, abs).split(path.sep).join('/');
      const joined = safeJoin(base, rel);
      if (!joined.ok) continue; // cannot happen for discovered files, but stay safe
      const raw = await fs.readFile(joined.path, 'utf8');
      docs.push(parseDoc(raw, rel, joined.path));
    }
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

function makeSnippet(content, terms) {
  const lower = content.toLowerCase();
  let firstIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
  }
  if (firstIdx === -1) return content.slice(0, SNIPPET_LENGTH).trim();
  const start = Math.max(0, firstIdx - 40);
  return content.slice(start, start + SNIPPET_LENGTH).trim();
}

// Loads every *.md file under dir (recursively) and returns the KB handle:
//   { docs, search(query, { limit }), getDoc(id) }
export async function loadKnowledgeBase(dir) {
  const base = path.resolve(dir);
  let stat;
  try {
    stat = await fs.stat(base);
  } catch {
    throw new Error(`knowledge base directory not found: ${dir}`);
  }
  if (!stat.isDirectory()) throw new Error(`knowledge base path is not a directory: ${dir}`);

  const docs = await discover(base, base);
  const byId = new Map(docs.map((d) => [d.id, d]));

  function search(query, { limit = 5 } = {}) {
    const terms = [...new Set(tokenize(query ?? ''))];
    if (terms.length === 0) return [];
    const scored = [];
    for (const doc of docs) {
      const titleLower = doc.title.toLowerCase();
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        score += TITLE_WEIGHT * countOccurrences(titleLower, term);
        score += CONTENT_WEIGHT * countOccurrences(contentLower, term);
      }
      if (score > 0) {
        scored.push({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          verified: doc.verified,
          score,
          snippet: makeSnippet(doc.content, terms),
        });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, Math.max(0, limit));
  }

  function getDoc(id) {
    if (typeof id !== 'string' || id.length === 0) return null;
    // Reject anything that escapes the KB directory, including absolute
    // paths and '..' segments, before touching the filesystem.
    const joined = safeJoin(base, id);
    if (!joined.ok) return null;
    const rel = path.relative(base, joined.path).split(path.sep).join('/');
    return byId.get(rel) ?? null;
  }

  return { docs, search, getDoc };
}
