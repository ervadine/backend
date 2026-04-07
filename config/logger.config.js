const winston = require('winston');
const { combine, timestamp, printf, errors } = winston.format;
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});

const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }), // This captures error stacks
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    })
  ],
  exitOnError: false
});

// Morgan stream integration
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = logger;