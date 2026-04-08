



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
const ALLOWED_ORIGINS = require('./utils/allowedOrigins')

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



app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration
const allowedOrigins = ALLOWED_ORIGINS.splice(',') 


app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Logging
if (NODE_ENV === 'DEVELOPMENT') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { 
    stream: logger.stream || process.stdout 
  }));
}




// Enhanced logging middleware for Edge debugging
app.use((req, res, next) => {
  console.log('=== EDGE DEBUG REQUEST ===');
  console.log('🍪 Cookies:', req.cookies);
  console.log('📨 Headers:', {
    'user-agent': req.headers['user-agent'],
    'x-cart-session-id': req.headers['x-cart-session-id'],
    'cookie': req.headers.cookie,
    'origin': req.headers.origin,
    'authorization': req.headers.authorization ? 'Present' : 'Missing',
    'accept': req.headers.accept,
    'content-type': req.headers['content-type']
  });
  console.log('🌐 Method & URL:', req.method, req.originalUrl);
  console.log('======================');
  next();
});

if (NODE_ENV === 'DEVELOPMENT') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { 
    stream: logger.stream || process.stdout 
  }));
}

// Socket.io initialization with enhanced CORS for Edge
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
      if (allowedOrigins.indexOf(origin) !== -1) {
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
  allowEIO3: true // Allow Engine.IO v3 compatibility
});

app.set('io', io);
logger.info('Socket.IO server initialized successfully');

// Middleware to attach io to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Enhanced cookie settings middleware for Edge
app.use((req, res, next) => {
  // Store original res.cookie function
  const originalCookie = res.cookie;
  
  // Override res.cookie for Edge compatibility
  res.cookie = function(name, value, options = {}) {
    const edgeCompatibleOptions = {
      httpOnly: options.httpOnly !== undefined ? options.httpOnly : true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax', // Critical for Edge
      maxAge: options.maxAge || 30 * 24 * 60 * 60 * 1000, // 30 days
      path: options.path || '/',
      domain: options.domain || (NODE_ENV === 'production' ? '.yourdomain.com' : undefined),
      // Edge-specific flags
      partitioned: NODE_ENV === 'production' // For Chrome but good practice
    };
    
    console.log(`🍪 Setting cookie: ${name}`, edgeCompatibleOptions);
    return originalCookie.call(this, name, value, edgeCompatibleOptions);
  };
  next();
});


fs.readdirSync('./routes').forEach(routeFile => {
  if (routeFile.endsWith('.js')) {
    try {
      const route = require(`./routes/${routeFile}`);
      const basePath = routeFile.replace('.js', '');
      app.use('/api/v1', route);
      console.log(`✅ Loaded route: /api/v1/${basePath}`);
    } catch (error) {
      console.error(`❌ Failed to load route ${routeFile}:`, error.message);
    }
  }
});





// Serve uploaded files statically with CORS
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, path) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
  }
}));



// Global error handler with CORS
app.use((error, req, res, next) => {
  console.log('❌ Global Error Handler:', error.message);
  
  // Set CORS headers even for errors
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  
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
  
  // Enhanced error response for CORS issues
  if (message.includes('CORS')) {
    return res.status(403).json({
      error: {
        status: 403,
        message: 'CORS policy violation',
        details: 'Request blocked by CORS policy. Please check your origin and credentials.',
        allowedOrigins: allowedOrigins,
        yourOrigin: req.headers.origin,
        userAgent: req.headers['user-agent']
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



// Enhanced process error handlers
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces
  console.log('🚀 Server started successfully');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
 
});
