const mongoose = require("mongoose");
const logger = require("./logger.config");

const connectDB = async () => {
  try {
    const uri = process.env.DATABASE_URL;
    
    if (!uri) {
      logger.error("No MongoDB connection URI found in environment variables");
      throw new Error("DATABASE_URL environment variable is required");
    }

    // Parse the connection string to check if it's valid
    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
      throw new Error("Invalid MongoDB connection string format");
    }

    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // Increased timeout for better reliability
      socketTimeoutMS: 45000, // Add socket timeout
      connectTimeoutMS: 10000, // Add connection timeout
      maxPoolSize: 10, // Maximum number of connections in the pool
      minPoolSize: 5, // Minimum number of connections in the pool
      retryWrites: true,
      w: 'majority'
    };

    const conn = await mongoose.connect(uri, options);

    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    logger.info(`Database: ${conn.connection.name}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    return conn;
  } catch (error) {
    logger.error(`Database connection failed: ${error.message}`);
    logger.error(`Connection URI: ${process.env.DATABASE_URL ? 'Present but hidden for security' : 'Not found'}`);
    process.exit(1);
  }
};

// Graceful shutdown handling
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

module.exports = connectDB;