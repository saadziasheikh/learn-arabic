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

let words = {};
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

function renderParagraph(text) {
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

function render(data) {
  document.title = data.title;
  titleEl.textContent = data.title;
  words = data.words || {};
  storyEl.innerHTML = data.paragraphs
    .map(p => `<p>${renderParagraph(p)}</p>`)
    .join('');
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
  if (e.key === 'Escape') hideTooltip();
});

window.addEventListener('scroll', () => {
  if (activeSpan) showTooltip(activeSpan);
});

window.addEventListener('resize', hideTooltip);
