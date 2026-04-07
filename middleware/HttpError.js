// middleware/HttpError.js
class HttpError extends Error {
  constructor(message, statusCode = 500, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
  
  toJSON() {
    return {
      success: false,
      error: {
        status: this.statusCode,
        message: this.message,
        ...(this.data && { data: this.data })
      }
    };
  }
}

module.exports = HttpError;