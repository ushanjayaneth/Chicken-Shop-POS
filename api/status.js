import {cloudKey} from '../lib/cloud-session.mjs';
import {firebaseConfigured} from '../lib/firebase-transport.mjs';

export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok:true,
    cloudConfigured:Boolean(cloudKey() && firebaseConfigured()),
    build:process.env.VERCEL_GIT_COMMIT_SHA || null
  });
}
