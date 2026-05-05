const ARABIC_WORD = /[ء-غف-يً-ْ]+/g;

// Normalize harakat so shadda (U+0651) comes BEFORE the vowel.
// Different input methods produce different orderings; lookup must match.
function normalize(s) {
  return s.replace(/([ً-ِ])(ّ)/g, '$2$1');
}

const params = new URLSearchParams(location.search);
const id = params.get('id');

const titleEl = document.getElementById('title');
const storyEl = document.getElementById('story');
const tooltipEl = document.getElementById('tooltip');
const modalEl = document.getElementById('tree-modal');
const treeEl = document.getElementById('tree-container');

let words = {};
let sentences = [];
let activeSpan = null;

if (!id) {
  storyEl.textContent = 'No story id specified.';
} else {
  fetch(`data/${encodeURIComponent(id)}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(render)
    .catch(err => {
      storyEl.textContent = `Could not load story: ${err.message}`;
    });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWords(text) {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(ARABIC_WORD)) {
    html += escapeHtml(text.slice(last, m.index));
    const w = m[0];
    const key = normalize(w);
    if (words[key]) {
      html += `<span class="word" data-word="${escapeHtml(key)}">${escapeHtml(w)}</span>`;
    } else {
      html += escapeHtml(w);
    }
    last = m.index + w.length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

// Splits a paragraph into sentences, keeping the terminator + trailing whitespace
// with each sentence so reflowed text matches the original exactly.
function splitSentences(paragraph) {
  const re = /[^.؟!]*[.؟!]+\s*|[^.؟!]+$/g;
  return paragraph.match(re) || [paragraph];
}

function renderParagraph(text, sentenceIdxStart, sentencesById) {
  const parts = splitSentences(text);
  let html = '';
  let sIdx = sentenceIdxStart;
  for (const part of parts) {
    const hasTree = sentencesById.has(sIdx);
    const marker = hasTree
      ? `<button class="sentence-marker" data-sid="${sIdx}" aria-label="Show grammatical analysis"></button>`
      : '';
    html += marker + renderWords(part);
    sIdx++;
  }
  return html;
}

function render(data) {
  document.title = data.title;
  titleEl.textContent = data.title;
  words = data.words || {};
  sentences = data.sentences || [];

  const sentencesById = new Map(sentences.map(s => [s.id, s]));

  let sIdx = 0;
  storyEl.innerHTML = data.paragraphs
    .map(p => {
      const html = renderParagraph(p, sIdx, sentencesById);
      sIdx += splitSentences(p).length;
      return `<p>${html}</p>`;
    })
    .join('');
}

// --- dependency tree renderer ---

function measureCtx() {
  if (!measureCtx.c) measureCtx.c = document.createElement('canvas').getContext('2d');
  return measureCtx.c;
}

function measure(text, font) {
  const ctx = measureCtx();
  ctx.font = font;
  return ctx.measureText(text).width;
}

function renderTree(tree) {
  const T = tree.tokens;
  const n = T.length;

  const FORM_FZ = 24, POS_FZ = 13, GLOSS_FZ = 12, REL_FZ = 12;
  const FORM_FONT  = `${FORM_FZ}px "Amiri","Scheherazade New",serif`;
  const POS_FONT   = `${POS_FZ}px "Amiri","Scheherazade New",serif`;
  const GLOSS_FONT = `${GLOSS_FZ}px sans-serif`;
  const REL_FONT   = `${REL_FZ}px "Amiri","Scheherazade New",serif`;

  const TOKEN_GAP = 28;
  const PADDING = 30;
  const ROW_GAP = 10;
  const ARC_BASE = 32;
  const ARC_PER_SPAN = 18;

  // Slot width = max of form / pos / gloss text widths + a little padding
  const slotW = T.map(t => Math.max(
    measure(t.form, FORM_FONT),
    measure(t.pos, POS_FONT),
    measure(t.gloss, GLOSS_FONT),
  ) + 8);

  const totalW = PADDING * 2
    + slotW.reduce((a, b) => a + b, 0)
    + (n - 1) * TOKEN_GAP;

  // Token centers — token 0 on the right (RTL reading order)
  const xCenter = [];
  let cursor = totalW - PADDING;
  for (let i = 0; i < n; i++) {
    cursor -= slotW[i] / 2;
    xCenter.push(cursor);
    cursor -= slotW[i] / 2 + TOKEN_GAP;
  }

  // Arcs (one per non-root token)
  const arcs = [];
  let maxArcH = ARC_BASE;
  for (let i = 0; i < n; i++) {
    if (T[i].head < 0) continue;
    const span = Math.abs(i - T[i].head);
    const h = ARC_BASE + ARC_PER_SPAN * span;
    if (h > maxArcH) maxArcH = h;
    arcs.push({ from: i, to: T[i].head, height: h, label: T[i].rel });
  }

  // Vertical layout (top to bottom): arcs area, form, pos, gloss
  const arcAreaH = maxArcH + REL_FZ + 12;
  const formY  = arcAreaH + ROW_GAP + FORM_FZ;
  const posY   = formY + ROW_GAP + POS_FZ;
  const glossY = posY + ROW_GAP + GLOSS_FZ;
  const totalH = glossY + PADDING;

  const arcBaseY = arcAreaH - 4;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" preserveAspectRatio="xMidYMid meet">`);

  // Arcs first (drawn under text)
  for (const a of arcs) {
    const x1 = xCenter[a.from];
    const x2 = xCenter[a.to];
    const peakY = arcBaseY - a.height;
    const midX = (x1 + x2) / 2;
    parts.push(
      `<path d="M ${x1} ${arcBaseY} C ${x1} ${peakY}, ${x2} ${peakY}, ${x2} ${arcBaseY}"
              fill="none" stroke="#a8865a" stroke-width="1.2" opacity="0.85"/>`
    );
    // small arrowhead at head end (pointing down at x2)
    parts.push(
      `<path d="M ${x2 - 4} ${arcBaseY - 6} L ${x2} ${arcBaseY} L ${x2 + 4} ${arcBaseY - 6}"
              fill="none" stroke="#a8865a" stroke-width="1.2"/>`
    );
    // relation label above arc apex
    parts.push(
      `<text class="tree-rel" x="${midX}" y="${peakY - 4}" text-anchor="middle"
             font-size="${REL_FZ}" fill="#5a4124">${escapeHtml(a.label)}</text>`
    );
  }

  // Tokens
  for (let i = 0; i < n; i++) {
    const x = xCenter[i];
    const t = T[i];
    parts.push(
      `<text class="tree-form" x="${x}" y="${formY}" text-anchor="middle"
             font-size="${FORM_FZ}" fill="#1a1a1a">${escapeHtml(t.form)}</text>`
    );
    parts.push(
      `<text class="tree-pos" x="${x}" y="${posY}" text-anchor="middle"
             font-size="${POS_FZ}" fill="#8b4513">${escapeHtml(t.pos)}</text>`
    );
    parts.push(
      `<text class="tree-gloss" x="${x}" y="${glossY}" text-anchor="middle"
             font-size="${GLOSS_FZ}" fill="#666">${escapeHtml(t.gloss)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

function openTreeModal(sid) {
  const tree = sentences.find(s => s.id === sid);
  if (!tree) return;
  treeEl.innerHTML = renderTree(tree);
  modalEl.style.display = '';
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeTreeModal() {
  modalEl.classList.remove('open');
  modalEl.style.display = 'none';
  treeEl.innerHTML = '';
  document.body.style.overflow = '';
}

function showTooltip(span) {
  const word = span.dataset.word;
  const annotation = words[word];
  if (!annotation) return;

  tooltipEl.textContent = annotation;
  tooltipEl.hidden = false;
  tooltipEl.classList.remove('below');

  const rect = span.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let top = rect.top + scrollY - tipRect.height - 10;
  let left = rect.left + scrollX + rect.width / 2 - tipRect.width / 2;

  // flip below if not enough room above
  if (top < scrollY + 8) {
    top = rect.bottom + scrollY + 10;
    tooltipEl.classList.add('below');
  }
  // clamp horizontally
  const margin = 8;
  if (left < scrollX + margin) left = scrollX + margin;
  const maxLeft = scrollX + document.documentElement.clientWidth - tipRect.width - margin;
  if (left > maxLeft) left = maxLeft;

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
  if (activeSpan) {
    activeSpan.classList.remove('active');
    activeSpan = null;
  }
}

document.addEventListener('click', e => {
  // modal close (backdrop or × button)
  if (e.target.closest('[data-close]')) {
    closeTreeModal();
    return;
  }
  // sentence marker → open tree
  const marker = e.target.closest('.sentence-marker');
  if (marker) {
    hideTooltip();
    openTreeModal(Number(marker.dataset.sid));
    return;
  }
  // word click → tooltip
  const span = e.target.closest('.word');
  if (!span) {
    hideTooltip();
    return;
  }
  if (activeSpan === span) {
    hideTooltip();
    return;
  }
  if (activeSpan) activeSpan.classList.remove('active');
  activeSpan = span;
  span.classList.add('active');
  showTooltip(span);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (modalEl.classList.contains('open')) closeTreeModal();
    else hideTooltip();
  }
});

window.addEventListener('scroll', () => {
  if (activeSpan) showTooltip(activeSpan);
});

window.addEventListener('resize', hideTooltip);
