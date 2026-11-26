const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.7"/><path d="m16 16 5 5"/>',
  bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"/>',
  activity: '<path d="M2 12h4l3-7 5 15 3-8h5"/>',
  heart: '<path d="M20.8 5.9a5.1 5.1 0 0 0-7.2 0L12 7.5l-1.6-1.6a5.1 5.1 0 1 0-7.2 7.2L12 22l8.8-8.9a5.1 5.1 0 0 0 0-7.2Z" transform="translate(0 -1)"/>',
  comment: '<path d="M20.5 14.5a3 3 0 0 1-3 3H9l-5.5 4v-15a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z"/><path d="M8 8h8M8 12h5"/>',
  timeline: '<path d="M5 4v16M5 7h6M5 16h6M12 4h8v6h-8zM12 13h8v6h-8z"/>',
  perspectives: '<circle cx="5.5" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8 10.7 7.3-4M8 13.3l7.3 4"/>',
  sources: '<path d="M4 7h6l2-3h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 9h16"/>',
  read: '<path d="M3 4.5c4.5-.8 6.5 0 9 2.3 2.5-2.3 4.5-3.1 9-2.3v14c-4.5-.8-6.5 0-9 2-2.5-2-4.5-2.8-9-2z"/><path d="M12 7v13"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  external: '<path d="M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M14 3h7v7M21 3l-9 9"/>',
  user: '<circle cx="12" cy="8.5" r="3.4"/><path d="M5 20c.4-3.7 3-6 7-6s6.6 2.3 7 6"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  share: '<path d="M12 15V3m-5 5 5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}
