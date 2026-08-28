/**
 * Convert renderer CSS-pixel rect (getBoundingClientRect) to BrowserView DIP bounds.
 * Shell page zoom scales CSS layout; setBounds speaks window DIPs → multiply by zoomFactor.
 */
function cssRectToViewBounds(rect, zoomFactor) {
  const z = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const x = Number(rect && rect.x);
  const y = Number(rect && rect.y);
  const width = Number(rect && rect.width);
  const height = Number(rect && rect.height);
  return {
    x: Math.max(0, Math.round((Number.isFinite(x) ? x : 0) * z)),
    y: Math.max(0, Math.round((Number.isFinite(y) ? y : 0) * z)),
    width: Math.max(0, Math.round((Number.isFinite(width) ? width : 0) * z)),
    height: Math.max(0, Math.round((Number.isFinite(height) ? height : 0) * z))
  };
}

module.exports = { cssRectToViewBounds };
