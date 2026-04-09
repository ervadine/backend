const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const http = require('http');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require("socket.io");
const { ALLOWED_ORIGINS } = require('./utils/allowedOrigins');

// Load environment variables
dotenv.config();

// Import custom modules
const connectDB = require('./config/dbConnect');
const logger = require('./config/logger.config');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8280;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Database connection
connectDB();

// Configure allowed origins
const allowedOriginsList = Array.isArray(ALLOWED_ORIGINS) 
  ? ALLOWED_ORIGINS 
  : ['http://localhost:3000','https://darcollections.com','darcollections.com','https://frontend-0sk8.onrender.com', 'http://127.0.0.1:3000', 'https://backend-x6tz.onrender.com', 'http://10.0.0.38:8280'];

console.log('🔄 Allowed CORS origins:', allowedOriginsList);

// ==================== CORS CONFIGURATION ====================
// This MUST be the first middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, Postman)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow all localhost variations (development)
    if (origin.includes('localhost') || 
        origin.includes('127.0.0.1') || 
        origin.includes('0.0.0.0') ||
        origin.includes('192.168.') ||
        origin.includes('10.0.0.')) {
      return callback(null, true);
    }
    
    // Allow any .onrender.com domain (production)
    if (origin.includes('.onrender.com')) {
      console.log('✅ CORS allowed for Render domain:', origin);
      return callback(null, true);
    }
    
    // Check against allowed origins list
    if (allowedOriginsList.some(allowed => origin.includes(allowed))) {
      return callback(null, true);
    }
    
    console.log('❌ CORS blocked for origin:', origin);
    callback(new Error(`CORS policy violation: Origin ${origin} not allowed`));
  },
  credentials: true, // Required for cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Cart-Session-Id',
    'x-cart-session-id',
    'Cookie',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: [
    'Set-Cookie', 
    'X-Cart-Session-Id',
    'x-cart-session-id',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Credentials'
  ],
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 
    'Content-Type, Authorization, X-Cart-Session-Id, x-cart-session-id, Cookie, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.status(204).send();
});

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:", "ws:", "wss:"],
    },
  }
}));

app.use(mongoSanitize());
app.use(compression());

// ==================== COOKIE PARSER ====================
app.use(cookieParser());

// ==================== REQUEST PARSING ====================
app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '50mb',
  parameterLimit: 100000
}));
app.use(express.json({ 
  limit: '50mb',
  type: ['application/json', 'text/plain']
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb',
  parameterLimit: 100000
}));

// ==================== CUSTOM COOKIE MIDDLEWARE ====================
app.use((req, res, next) => {
  const originalCookie = res.cookie;
  
  // Detect environment
  const origin = req.headers.origin || '';
  const isLocalhost = origin.includes('localhost') || 
                      origin.includes('127.0.0.1') ||
                      origin.includes('10.0.0.');
  const isProduction = origin.includes('.onrender.com') || 
                       process.env.NODE_ENV === 'production';
  
  res.cookie = function(name, value, options = {}) {
    // Default cookie options
    const cookieOptions = {
      httpOnly: options.httpOnly !== undefined ? options.httpOnly : true,
      secure: isProduction ? true : false, // Must be true in production for SameSite=None
      sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin
      maxAge: options.maxAge || 30 * 24 * 60 * 60 * 1000, // 30 days
      path: options.path || '/',
    };
    
    // Add domain for production if needed
    if (isProduction && !cookieOptions.domain) {
      cookieOptions.domain = '.onrender.com';
    }
    
    // Merge with any passed options
    Object.assign(cookieOptions, options);
    
    console.log(`🍪 Setting cookie: ${name}`, {
      value: value ? value.substring(0, 20) + '...' : 'null',
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      domain: cookieOptions.domain,
      isProduction
    });
    
    return originalCookie.call(this, name, value, cookieOptions);
  };
  next();
});

// ==================== REQUEST LOGGING MIDDLEWARE ====================
app.use((req, res, next) => {
  console.log('=== REQUEST DEBUG ===');
  console.log('🍪 Cookies:', req.cookies);
  console.log('📨 Headers:', {
    'user-agent': req.headers['user-agent'],
    'x-cart-session-id': req.headers['x-cart-session-id'],
    'cookie': req.headers.cookie ? 'Present' : 'Missing',
    'origin': req.headers.origin,
    'authorization': req.headers.authorization ? 'Present' : 'Missing',
  });
  console.log('🌐 Method & URL:', req.method, req.originalUrl);
  console.log('==================');
  next();
});

// ==================== MORGAN LOGGING ====================
if (NODE_ENV === 'DEVELOPMENT') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { 
    stream: logger.stream || process.stdout 
  }));
}

// ==================== SOCKET.IO ====================
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('.onrender.com')) {
        return callback(null, true);
      }
      if (allowedOriginsList.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'x-cart-session-id',
      'Cookie',
      'Origin'
    ],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

logger.info('Socket.IO server initialized successfully');

// Make io accessible to routes
app.set('io', io);

// ==================== LOAD ROUTES ====================
fs.readdirSync('./routes').forEach(routeFile => {
  if (routeFile.endsWith('.js')) {
    try {
      const route = require(`./routes/${routeFile}`);
      app.use('/api/v1', route);
      console.log(`✅ Loaded route: /api/v1/${routeFile.replace('.js', '')}`);
    } catch (error) {
      console.error(`❌ Failed to load route ${routeFile}:`, error.message);
    }
  }
});

// ==================== STATIC FILES ====================
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, path) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
  }
}));

// ==================== TEST ENDPOINT FOR CORS ====================
app.get('/api/v1/test-cors', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    cookies: req.cookies,
    headers: req.headers,
    origin: req.headers.origin,
    environment: NODE_ENV
  });
});

// ==================== GLOBAL ERROR HANDLER ====================
app.use((error, req, res, next) => {
  console.log('❌ Global Error Handler:', error.message);
  
  // Set CORS headers for error responses
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Clean up uploaded file if exists
  if (req.file) {
    fs.unlink(req.file.path, err => {
      if (err) logger.error(`Error deleting file: ${err.message}`, { stack: err.stack });
    });
  }
  
  if (res.headerSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  const message = error.message || 'An unexpected error occurred';
  
  logger.error(`${statusCode} - ${message}`, { 
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    stack: error.stack,
    userAgent: req.headers['user-agent']
  });
  
  // Handle CORS errors specifically
  if (message.includes('CORS') || message.includes('Not allowed by CORS')) {
    return res.status(403).json({
      error: {
        status: 403,
        message: 'CORS policy violation',
        details: 'Request blocked by CORS policy',
        allowedOrigins: allowedOriginsList,
        yourOrigin: req.headers.origin
      }
    });
  }
  
  res.status(statusCode).json({
    error: {
      status: statusCode,
      message: message,
      stack: NODE_ENV === 'DEVELOPMENT' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }
  });
});

// ==================== PROCESS ERROR HANDLERS ====================
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', { 
    error: err.message,
    stack: err.stack 
  });
  console.error('💥 Uncaught Exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...', { 
    error: err.message,
    stack: err.stack 
  });
  console.error('💥 Unhandled Rejection:', err);
  server.close(() => setTimeout(() => process.exit(1), 1000));
});

process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

// ==================== START SERVER ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server started successfully');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`🌐 Listening on: 0.0.0.0 (all interfaces)`);
  console.log(`✅ CORS Enabled for origins:`, allowedOriginsList);
  console.log(`🍪 Cookie settings: ${NODE_ENV === 'production' ? 'Secure + SameSite=None' : 'SameSite=Lax'}`);
  logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
});

module.exports = { app, server, io };
