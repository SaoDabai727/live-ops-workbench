/**
 * Feedback loop for shell-zoom ↔ BrowserView adaptation.
 * Exit 0 = product conversion + zoom sync correct (green).
 * Exit 1 = still broken (red).
 *
 * Usage: npx electron test/zoom-bounds-harness.js
 */
const { app, BrowserWindow, BrowserView } = require('electron');
const { cssRectToViewBounds } = require('../main/layoutBounds');

const ZOOM = 1.5;
const TOL = 3;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    useContentSize: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<!doctype html><html><head><style>
        html,body{margin:0;height:100%;overflow:hidden}
        #toolbar{height:42px;background:#222}
        #body{display:flex;height:calc(100% - 42px)}
        #sidebar{width:128px;flex:0 0 128px;background:#333}
        #main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
        #tabbar{height:40px;background:#444}
        #content-slot{flex:1;min-height:0;min-width:0;background:#111}
      </style></head><body>
        <div id="toolbar"></div>
        <div id="body"><div id="sidebar"></div>
          <div id="main"><div id="tabbar"></div><div id="content-slot"></div></div>
        </div>
      </body></html>`)
  );

  const view = new BrowserView();
  win.addBrowserView(view);
  await view.webContents.loadURL('data:text/html,<body style="margin:0;background:#0af">ok</body>');

  win.webContents.setZoomFactor(ZOOM);
  await new Promise((r) => setTimeout(r, 200));

  const cssRect = await win.webContents.executeJavaScript(`(() => {
    const r = document.getElementById('content-slot').getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);

  const shellZoom = win.webContents.getZoomFactor();
  const expected = cssRectToViewBounds(cssRect, shellZoom);

  // Product path
  view.setBounds(expected);
  view.webContents.setZoomFactor(shellZoom);
  await new Promise((r) => setTimeout(r, 50));

  const actual = view.getBounds();
  const viewZoom = view.webContents.getZoomFactor();

  // Naive path (pre-fix) for regression signal
  const naive = {
    x: Math.round(cssRect.x),
    y: Math.round(cssRect.y),
    width: Math.round(cssRect.width),
    height: Math.round(cssRect.height)
  };
  const naiveWouldMismatch =
    Math.abs(naive.x - expected.x) > TOL ||
    Math.abs(naive.y - expected.y) > TOL ||
    Math.abs(naive.width - expected.width) > TOL ||
    Math.abs(naive.height - expected.height) > TOL;

  const fixedOk =
    Math.abs(actual.x - expected.x) <= TOL &&
    Math.abs(actual.y - expected.y) <= TOL &&
    Math.abs(actual.width - expected.width) <= TOL &&
    Math.abs(actual.height - expected.height) <= TOL &&
    Math.abs(viewZoom - shellZoom) <= 0.01;

  console.log(JSON.stringify({
    shellZoom,
    viewZoom,
    cssRect,
    naive,
    expected,
    actual,
    naiveWouldMismatch,
    fixedOk
  }, null, 2));

  if (fixedOk && naiveWouldMismatch) {
    console.log('GREEN: zoom-aware bounds + sync ok');
    app.exit(0);
    return;
  }
  console.error('RED: product zoom adaptation failed');
  app.exit(1);
});
