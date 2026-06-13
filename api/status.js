export default function handler(req, res) {
  // Set headers to prevent caching of status checks
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.status(200).json({
    blocked: false,
    message: 'ok'
  });
}
