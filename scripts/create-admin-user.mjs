// scripts/create-admin-user.mjs
import https from 'https';

import fs from 'fs';

let API_KEY = process.env.VITE_FIREBASE_API_KEY;
let defaultAdminEmail = process.env.VITE_ADMIN_EMAIL;

if (!API_KEY && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('VITE_FIREBASE_API_KEY=')) {
      API_KEY = trimmed.substring('VITE_FIREBASE_API_KEY='.length).trim();
    }
    if (trimmed.startsWith('VITE_ADMIN_EMAIL=')) {
      defaultAdminEmail = trimmed.substring('VITE_ADMIN_EMAIL='.length).trim();
    }
  }
}

if (!API_KEY) {
  console.error('Error: VITE_FIREBASE_API_KEY is not set. Please set it in .env or the environment.');
  process.exit(1);
}

const email = process.argv[2] || defaultAdminEmail || "admin@rescue.internal";
const password = process.argv[3];

if (!password) {
  console.log(`
Usage:
  node scripts/create-admin-user.mjs <admin_email> <password>
  
Example:
  node scripts/create-admin-user.mjs admin@rescue.internal MySuperSecretAdmin123!
`);
  process.exit(1);
}

const payload = JSON.stringify({
  email,
  password,
  returnSecureToken: true,
});

const req = https.request(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      const response = JSON.parse(data);
      if (response.error) {
        if (response.error.message === 'EMAIL_EXISTS') {
          console.log(`Admin user (${email}) already exists in Firebase.`);
          console.log('To update their password, you can change it in the Firebase Console or sign in and update.');
        } else {
          console.error('Error creating admin user:', response.error.message);
        }
      } else {
        console.log(`Successfully created admin user: ${response.email}`);
        console.log(`UID: ${response.localId}`);
        console.log('You can now log in at /admin-li with this password!');
      }
    });
  }
);

req.on('error', (e) => console.error('Request error:', e.message));
req.write(payload);
req.end();
