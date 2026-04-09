// utils/allowedOrigins.js
const ALLOWED_ORIGINS = [
  'localhost:3000',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://127.0.0.1:3000',
  'https://127.0.0.1:3000',
  'http://10.0.0.38:3000',  // Add your frontend port
  'https://darcollections.com',  // Replace with your actual frontend domain
  'https://frontend-0sk8.onrender.com',  // If frontend is on render
  'https://backend-x6tz.onrender.com',
  'http://10.0.0.38:8280'
];

module.exports = ALLOWED_ORIGINS;
