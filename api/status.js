export default function handler(req, res) {
  // Set headers to prevent caching of status checks
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Check the Vercel environment variable (defaults to true/blocked unless explicitly set to 'false')
  const isBlocked = process.env.SYSTEM_BLOCKED !== 'false';

  res.status(200).json({
    blocked: isBlocked,
    message: isBlocked
      ? 'This system has been suspended due to an outstanding payment. Please contact the service provider to restore access.'
      : 'ok'
  });
}
