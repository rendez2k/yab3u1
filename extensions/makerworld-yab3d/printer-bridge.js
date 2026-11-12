// Printer bridge rules, shared by the background script and its tests.
//
// A YAB3D page may ask the extension to contact one printer on the home network. The
// extension only ever reads the printer's state and filament slots, and sets a slot's
// filament label. It cannot start, stop or change a print.
(function (root) {
  const STATUS_ROUTE = '/printer/objects/query?gcode=commands&print_stats=state&idle_timeout=state'
    + '&print_task_config=filament_vendor,filament_type,filament_sub_type,filament_color_rgba,filament_spool_id,filament_exist';
  const READ_ROUTES = ['/server/info', STATUS_ROUTE];
  const WRITE_ROUTE = '/printer/gcode/script';
  const LABEL = /^SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=([0-3]) VENDOR='Generic' FILAMENT_TYPE='(PLA|PETG|ABS|ASA|TPU|PA|PC|PVA|HIPS)' FILAMENT_SUBTYPE='(Basic|Matte|Silk)' FILAMENT_COLOR_RGBA=[A-F0-9]{6}FF$/;
  const PAGES = ['https://yab3d.uk'];

  /** The printer's origin when it is a plain private IPv4 address, or null. */
  function printerOrigin(value) {
    let url;
    try { url = new URL(String(value)); } catch { return null; }
    const ip = url.hostname.split('.').map(Number);
    const local = ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
      && (ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31));
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !local) return null;
    return url.origin;
  }

  /** Why a request is refused, or '' when it is one of the few allowed. */
  function refusal({ page, printer, route, body }) {
    if (!PAGES.includes(page)) return 'Only YAB3D can use this connection.';
    if (!printerOrigin(printer)) return 'Supply the printer as a private address, for example http://192.168.1.100';
    if (body == null) return READ_ROUTES.includes(route) ? '' : 'That printer request is not supported.';
    if (route !== WRITE_ROUTE || typeof body.script !== 'string' || Object.keys(body).length !== 1 || !LABEL.test(body.script))
      return 'Only filament label changes can be sent to the printer.';
    return '';
  }

  /** Whether the printer is in a state where a slot's label may be changed. */
  function writable(info, snapshot, script) {
    const slot = Number(LABEL.exec(script)[1]), s = snapshot?.result?.status, c = s?.print_task_config;
    const spool = c?.filament_spool_id?.[slot] ?? (info?.result?.components?.includes('spoollink') ? null : 0);
    return info?.result?.klippy_state === 'ready'
      && ['standby', 'complete', 'cancelled'].includes(s?.print_stats?.state)
      && ['Idle', 'Ready'].includes(s?.idle_timeout?.state)
      && Object.prototype.hasOwnProperty.call(s?.gcode?.commands || {}, 'SET_PRINT_FILAMENT_CONFIG')
      && c?.filament_exist?.[slot] === true && spool === 0;
  }

  const api = { STATUS_ROUTE, PAGES, printerOrigin, refusal, writable };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.yab3dPrinterBridge = api;
})(typeof self !== 'undefined' ? self : globalThis);
