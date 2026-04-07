
// config/twilio.js
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Add validation for credentials
if (!accountSid || !authToken) {
  console.error('Twilio credentials are missing. Please check your environment variables.');
  // For development, you can continue but SMS will be simulated
}

// Initialize Twilio client only if credentials are available
let twilioClient = null;

if (accountSid && authToken) {
  try {
    twilioClient = twilio(accountSid, authToken);
    console.log('Twilio client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Twilio client:', error.message);
  }
} else {
  console.log('Twilio credentials not found. SMS will be simulated in development mode.');
}

module.exports = twilioClient;