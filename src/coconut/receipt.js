export function open80mmPrintWindow(doc) {
      const title = doc?.title || 'Receipt';
      const body = doc?.html || `<pre>${esc(doc?.text || '')}</pre>`;
      const w = window.open('', '_blank');
      if (!w) {
        toast('Please allow popups to print this receipt.', 'error');
        return;
      }
      w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #000; }
    body { padding: 4mm; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.32; }
    .receipt80 { width: 72mm; max-width: 72mm; margin: 0 auto; color: #000; }
    .receipt80-head { text-align: center; border-bottom: 1px dashed #111; padding-bottom: 6px; margin-bottom: 7px; }
    .receipt80-shop { font-size: 15px; font-weight: 900; line-height: 1.2; word-break: break-word; }
    .receipt80-title { margin-top: 3px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; }
    .receipt80-row, .receipt80-line { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
    .receipt80-row strong, .receipt80-line strong { text-align: right; }
    .receipt80-items { border-top: 1px dashed #111; border-bottom: 1px dashed #111; padding: 5px 0; margin: 6px 0; }
    .receipt80-item { padding: 3px 0; break-inside: avoid; page-break-inside: avoid; }
    .receipt80-name { font-weight: 800; word-break: break-word; }
    .receipt80-calc { display: flex; justify-content: space-between; gap: 8px; font-family: monospace; font-size: 10.5px; }
    .receipt80-total { font-size: 13px; font-weight: 900; border-top: 1px dashed #111; margin-top: 5px; padding-top: 5px; }
    .receipt80-note { margin-top: 7px; font-size: 10.5px; white-space: pre-wrap; word-break: break-word; }
    .receipt80-foot { margin-top: 10px; text-align: center; border-top: 1px dashed #111; padding-top: 6px; font-size: 10px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: Consolas, monospace; }
  </style>
</head>
<body>${body}</body>
</html>`);
      w.document.close();
      setTimeout(() => {
        w.focus();
        w.print();
      }, 250);
    }
