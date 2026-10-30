'use client';
/* The library's icons: one stroke, currentColor. Shared by toolbar, detail panel and edit panel. */
export const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg className="gb-ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden><path d={d} /></svg>
);
export const I = {
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm4.75 11.25L20 20',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4',
  more: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  warn: 'M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.5v.5',
  arrow: 'M5 12h13M13 7l5 5-5 5',
  stack: 'M12 4 3 8.5l9 4.5 9-4.5L12 4ZM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  legend: 'M5 7h.01M9 7h10M5 12h.01M9 12h10M5 17h.01M9 17h10',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  collapse: 'M6 15l6-6 6 6',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5',
};
