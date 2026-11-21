// Hand-drawn road-sign glyphs for the HUD. 24x24, stroked with currentColor, square caps like
// sign-painter brushwork. No icon fonts, no emoji. Keys used by Hud.js must stay stable.

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="sdh-ico"${extra}>${body}</svg>`;

export const ICON = Object.freeze({
  camera: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><path d="M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>'),
  pause: svg('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>'),
  expand: svg('<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>'),
  shrink: svg('<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/>'),
  // Settings: three sign-post sliders.
  sliders: svg('<path d="M4 6h16M4 12h16M4 18h16"/><path d="M14 4h3v4h-3zM6 10h3v4H6zM11 16h3v4h-3z" fill="currentColor"/>'),
  settings: svg('<path d="M4 6h16M4 12h16M4 18h16"/><path d="M14 4h3v4h-3zM6 10h3v4H6zM11 16h3v4h-3z" fill="currentColor"/>'),
  respawn: svg('<path d="M5 12a7 7 0 1 0 2-5"/><path d="M4 3v5h5"/>'),
  play: svg('<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>'),
  restart: svg('<path d="M19 12a7 7 0 1 1-2-5"/><path d="M20 3v5h-5"/>'),
  home: svg('<path d="M3 11 12 4l9 7M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  back: svg('<path d="M15 4 7 12l8 8"/>'),
  check: svg('<path d="m4 12.5 5 5L20 6"/>'),
  ghost: svg('<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z"/><path d="M9 9h1.5v2H9zM13.5 9H15v2h-1.5z" fill="currentColor"/>'),
  trophy: svg('<path d="M7 3h10v6a5 5 0 0 1-10 0z"/><path d="M7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 14v4M7 21h10M9 18h6"/>'),
  medal: svg('<path d="M7 2l3 7M17 2l-3 7"/><path d="M12 9.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/><path d="M12 12.5v6M9.5 14l2.5-1.5" />'),
  // Garage: a spanner.
  car: svg('<path d="M14.5 3.5a5 5 0 0 0-5.3 6.8L3 16.5 7.5 21l6.2-6.2a5 5 0 0 0 6.8-5.3l-3 3-3.5-.5-.5-3.5z"/>'),
  spanner: svg('<path d="M14.5 3.5a5 5 0 0 0-5.3 6.8L3 16.5 7.5 21l6.2-6.2a5 5 0 0 0 6.8-5.3l-3 3-3.5-.5-.5-3.5z"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),
  flame: svg('<path d="M12 22c-4 0-7-2.8-7-6.6 0-3.6 2.8-5.5 3.8-9.4 2.4 1.6 3.2 3.6 3.3 5.4 1.1-.8 1.7-2 1.8-3.6C16.5 9.9 19 12.6 19 15.6 19 19.4 16 22 12 22z" fill="currentColor" stroke="none"/>'),
  lock: svg('<path d="M5 11h14v10H5z"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
  user: svg('<path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0"/>'),
  flag: svg('<path d="M5 22V3"/><path d="M5 4h14l-3 4 3 4H5" fill="currentColor"/>'),
  // Hairpin: the switchback road sign.
  hairpin: svg('<path d="M7 21V9a4 4 0 0 1 8 0v4a2 2 0 0 0 4 0V3"/><path d="M16 6l3-3 3 3"/>'),
  chai: svg('<path d="M6 7h12l-1.6 13H7.6z"/><path d="M6.6 11.5h10.8" /><path d="M7.4 11.5h9.2l-1 8.5H8.4z" fill="currentColor" stroke="none" opacity=".55"/>'),
  steam: svg('<path d="M9 20c-2-2 2-4 0-6s2-4 0-6M15 20c-2-2 2-4 0-6s2-4 0-6"/>'),
  horn: svg('<path d="M3 10h4l9-5v14l-9-5H3z"/><path d="M19 9c1.2 1.6 1.2 4.4 0 6"/>'),
  // Party: two road-sign posts side by side.
  party: svg('<path d="M3 21V8h7v13M14 21V4h7v17M3 21h18"/><path d="M5.5 11h2M16.5 8h2M16.5 12h2" />'),
  // Host: a pagdi-like crest (three-peaked crown on a band).
  host: svg('<path d="M3 18 4 7l5 5 3-8 3 8 5-5 1 11z" fill="currentColor"/><path d="M3 21h18"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  exit: svg('<path d="M10 4H4v16h6M9 12h11M16 8l4 4-4 4"/>'),
  wifi: svg('<path d="M2 9c5.5-5 14.5-5 20 0M5.5 12.5c3.6-3.2 9.4-3.2 13 0M9 16c1.8-1.5 4.2-1.5 6 0"/><path d="M11 19h2v2h-2z" fill="currentColor"/>'),
});

/** A small chai glass with a two-wisp steam animation (CSS drives .sdh-steam paths). */
export const CHAI_GLASS = `<svg class="sdh-chai" viewBox="0 0 40 52" aria-hidden="true">
  <path class="sdh-steam" d="M15 14c-3-3 3-5 0-8"/>
  <path class="sdh-steam sdh-steam-2" d="M24 14c-3-3 3-5 0-8"/>
  <path class="sdh-chai-glass" d="M7 18h26l-3.2 30H10.2z"/>
  <path class="sdh-chai-tea" d="M9.4 28h21.2l-2.1 18H11.5z"/>
  <path class="sdh-chai-rim" d="M7 18h26"/>
</svg>`;
