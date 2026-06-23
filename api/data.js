export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Enterprise Security: Validate JWT token from Authorization header if present
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      // Validate project audience and expiration time
      if (payload.aud !== 'chicken-shop-2d7b5') {
        return res.status(401).json({ error: 'Unauthorized: Invalid project aud' });
      }
      if (payload.exp * 1000 < Date.now()) {
        return res.status(401).json({ error: 'Unauthorized: Token expired' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token format', details: e.message });
    }
  }

  const FIREBASE_URL = 'https://chicken-shop-2d7b5-default-rtdb.firebaseio.com';
  const path = req.query.path || '';

  const targetUrl = `${FIREBASE_URL}/${path}.json`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (['PUT', 'PATCH', 'POST'].includes(req.method) && req.body) {
      fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to communicate with remote database', details: error.message });
  }
}

