function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function safeUrl(value) {
  if (typeof value !== 'string') return '';
  const url = URL.parse(value);
  return url?.protocol === 'https:' && !url.username && !url.password ? escapeHtml(url.href) : '';
}

export function renderArticleReader(details) {
  if (!Array.isArray(details?.paragraphs) || !['full', 'excerpt'].includes(details.scope)) return '';
  const paragraphs = details.paragraphs.filter(paragraph => typeof paragraph === 'string' && paragraph.trim());
  if (!paragraphs.length) return '';

  const full = details.scope === 'full';
  const licenseUrl = safeUrl(details.licenseUrl);
  const sourceUrl = safeUrl(details.sourceUrl);
  if (full && (!licenseUrl || !sourceUrl || !details.attribution || !details.licenseName)) return '';

  const language = ['en', 'hi'].includes(details.language) ? ` lang="${details.language}"` : '';
  return `<section class="article-reader" aria-label="${full ? 'Article' : 'Publisher excerpt'}"${language}>
    ${full ? `<p class="article-attribution"><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(details.attribution)}</a> · <a href="${licenseUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(details.licenseName)}</a></p>` : '<h2>Publisher excerpt</h2>'}
    ${paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}
  </section>`;
}
