const nodemailer = require("nodemailer");
const path = require("path");
const { createPool } = require("generic-pool");
const { EventEmitter } = require("events");
const fs = require("fs").promises;

const {
  SMTP_FROM_USER,
  SMTP_PASSWORD,
  SMTP_FROM_NAME,
  SMTP_FROM_EMAIL,
  SMTP_HOST = "smtp.gmail.com",
  SMTP_PORT = 587,
  SMTP_SECURE = false,
  SMTP_BACKUP_HOST,
  SMTP_BACKUP_PORT,
  APP_NAME = "Dar Collection",
  NODE_ENV = "development",
  CLIENT_URL = "http://localhost:3000",
} = process.env;

class EmailService extends EventEmitter {
  constructor() {
    super();
    this.transporters = [];
    this.currentTransporterIndex = 0;
    this.sendQueue = [];
    this.isProcessingQueue = false;
    this.lastSendTime = 0;
    this.MIN_SEND_INTERVAL = 1500;
    this.MAX_FAILURES = 3;
    this.BASE_DISABLE_TIME = 5 * 60 * 1000; // 5 minutes
    this.initialize();
  }

  /* ------------------------- Helper Methods ------------------------- */

  formatDate(dateString) {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (!(date instanceof Date) || isNaN(date)) {
      return new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  formatPrice(amount) {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numAmount || 0);
  }

  getProductImage(item) {
    if (item.product?.colors?.availableColors?.[0]?.images?.[0]?.url) {
      return item.product.colors.availableColors[0].images[0].url;
    }
    if (item.product?.colors?.availableColors?.[0]?.images?.[0]) {
      return item.product.colors.availableColors[0].images[0];
    }
    return null;
  }

  getProductName(item) {
    return item.product?.name || 'Product';
  }

  getVariantDetails(item) {
    const details = [];
    
    if (item.variant?.colorValue) {
      details.push(`<span style="color:${item.variant.colorValue}">●</span> `);
    }
    
    if (item.variant?.sizeValue) {
      details.push(item.variant.sizeValue);
    }
    
    return details.join(' ');
  }

  /* ------------------------- SMTP Configuration ------------------------- */

  getSmtpConfig(host, port, secure) {
    return {
      host,
      port: parseInt(port),
      secure: secure === "true",
      auth: {
        user: SMTP_FROM_USER,
        pass: SMTP_PASSWORD,
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 30000,
      debug: NODE_ENV !== "production",
    };
  }

  createSmtpPool(config) {
    return createPool(
      {
        create: async () => {
          const transporter = nodemailer.createTransport(config);
          await transporter.verify();
          return transporter;
        },
        destroy: (transporter) => transporter.close(),
        validate: (transporter) => transporter.verify(),
      },
      {
        min: 1,
        max: 2,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
      }
    );
  }

  /* ------------------------- Core Methods ------------------------- */

  async initialize() {
    // Primary SMTP
    const primaryConfig = this.getSmtpConfig(SMTP_HOST, SMTP_PORT, SMTP_SECURE);
    this.transporters.push({
      name: "primary",
      pool: this.createSmtpPool(primaryConfig),
      config: primaryConfig,
      failureCount: 0,
      disabledUntil: 0,
    });

    // Backup SMTP if available
    if (SMTP_BACKUP_HOST) {
      const backupConfig = this.getSmtpConfig(
        SMTP_BACKUP_HOST,
        SMTP_BACKUP_PORT || SMTP_PORT,
        SMTP_SECURE
      );
      this.transporters.push({
        name: "backup",
        pool: this.createSmtpPool(backupConfig),
        config: backupConfig,
        failureCount: 0,
        disabledUntil: 0,
      });
    }
  }

  async getActiveTransporter() {
    for (let i = 0; i < this.transporters.length; i++) {
      const transporter = this.transporters[this.currentTransporterIndex];
      this.currentTransporterIndex =
        (this.currentTransporterIndex + 1) % this.transporters.length;

      if (transporter.disabledUntil <= Date.now()) {
        try {
          const conn = await transporter.pool.acquire();
          await transporter.pool.release(conn);
          transporter.failureCount = 0;
          return transporter;
        } catch (error) {
          this.handleTransporterFailure(transporter);
        }
      }
    }
    throw new Error("No available SMTP transporters");
  }

  handleTransporterFailure(transporter) {
    transporter.failureCount++;

    if (transporter.failureCount >= this.MAX_FAILURES) {
      transporter.disabledUntil = Date.now() + this.BASE_DISABLE_TIME;
      console.warn(
        `Disabled ${transporter.name} SMTP for ${
          this.BASE_DISABLE_TIME / 60000
        } minutes`
      );
    }
  }

  /* ------------------------- Email Sending ------------------------- */

  async sendEmail(mailOptions, retries = 3) {
    return new Promise((resolve, reject) => {
      this.sendQueue.push({ mailOptions, retries, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.sendQueue.length === 0) return;
    this.isProcessingQueue = true;

    const { mailOptions, retries, resolve, reject } = this.sendQueue.shift();

    try {
      // Rate limiting
      const now = Date.now();
      if (now - this.lastSendTime < this.MIN_SEND_INTERVAL) {
        await new Promise((r) =>
          setTimeout(r, this.MIN_SEND_INTERVAL - (now - this.lastSendTime))
        );
      }

      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const transporter = await this.getActiveTransporter();
          const conn = await transporter.pool.acquire();

          const info = await conn.sendMail({
            ...mailOptions,
            from:
              mailOptions.from || `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
          });

          await transporter.pool.release(conn);
          this.lastSendTime = Date.now();
          resolve(info);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < retries)
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      reject(lastError || new Error("Email sending failed"));
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessingQueue = false;
      process.nextTick(() => this.processQueue());
    }
  }

  /* ------------------------- Order Emails ------------------------- */

  async sendOrderConfirmation(email, name, order) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Confirmation - ${order.orderNumber}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f7fafc;
              margin: 0;
              padding: 0;
            }
            
            .email-container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
            }
            
            .header {
              background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
              padding: 40px 30px;
              text-align: center;
              color: white;
            }
            
            .logo {
              font-size: 28px;
              font-weight: bold;
              margin-bottom: 10px;
              color: white;
              text-decoration: none;
            }
            
            .order-number {
              font-size: 24px;
              font-weight: 600;
              margin: 20px 0 10px;
            }
            
            .order-date {
              font-size: 16px;
              opacity: 0.9;
            }
            
            .content {
              padding: 40px 30px;
            }
            
            .greeting {
              color: #1e293b;
              font-size: 18px;
              margin-bottom: 25px;
            }
            
            .status-badge {
              display: inline-block;
              background: #dbeafe;
              color: #1d4ed8;
              padding: 8px 16px;
              border-radius: 20px;
              font-size: 14px;
              font-weight: 500;
              margin: 10px 0 30px;
            }
            
            .section {
              margin-bottom: 35px;
            }
            
            .section-title {
              color: #1e293b;
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            
            .item-grid {
              width: 100%;
              border-collapse: collapse;
            }
            
            .item-row {
              border-bottom: 1px solid #e2e8f0;
            }
            
            .item-image {
              width: 70px;
              padding: 15px 0;
            }
            
            .item-image img {
              width: 70px;
              height: 70px;
              object-fit: cover;
              border-radius: 8px;
              border: 1px solid #e2e8f0;
            }
            
            .item-details {
              padding: 15px;
              vertical-align: top;
            }
            
            .item-name {
              font-weight: 600;
              color: #1e293b;
              margin-bottom: 5px;
            }
            
            .item-variant {
              color: #64748b;
              font-size: 14px;
              margin-bottom: 5px;
            }
            
            .item-price {
              color: #1e293b;
              font-weight: 500;
            }
            
            .totals {
              background: #f8fafc;
              padding: 25px;
              border-radius: 10px;
              margin-top: 30px;
            }
            
            .total-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              color: #64748b;
            }
            
            .total-row.final {
              font-weight: 600;
              color: #1e293b;
              font-size: 18px;
              border-top: 2px solid #e2e8f0;
              padding-top: 15px;
              margin-top: 10px;
            }
            
            .address-box {
              background: #f8fafc;
              padding: 20px;
              border-radius: 8px;
              margin-top: 10px;
            }
            
            .address-name {
              font-weight: 600;
              color: #1e293b;
              margin-bottom: 8px;
            }
            
            .address-line {
              color: #64748b;
              line-height: 1.5;
            }
            
            .footer {
              background: #f1f5f9;
              padding: 30px;
              text-align: center;
              color: #64748b;
              font-size: 14px;
              border-top: 1px solid #e2e8f0;
            }
            
            .help-text {
              margin-top: 20px;
              font-size: 14px;
              color: #94a3b8;
            }
            
            .button {
              display: inline-block;
              background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 500;
              margin: 20px 0;
              transition: all 0.3s ease;
            }
            
            .button:hover {
              background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
              transform: translateY(-1px);
              box-shadow: 0 6px 20px rgba(37, 99, 235, 0.2);
            }
            
            @media (max-width: 600px) {
              .content, .header {
                padding: 30px 20px;
              }
              
              .item-image, .item-image img {
                width: 50px;
                height: 50px;
              }
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1 class="order-number">Order #${order.orderNumber}</h1>
              <p class="order-date">Placed on ${this.formatDate(order.createdAt)}</p>
            </div>
            
            <div class="content">
              <p class="greeting">Hello ${name},</p>
              <p>Thank you for your order! We're processing it and will send you a notification when it ships.</p>
              
              <div class="status-badge">
                Payment Status: ${order.payment?.status === 'completed' ? '✅ Paid' : '⏳ Pending'}
              </div>
              
              <!-- Order Items -->
              <div class="section">
                <h2 class="section-title">Order Details</h2>
                <table class="item-grid">
                  ${(order.items || []).map(item => `
                    <tr class="item-row">
                      <td class="item-image">
                        ${this.getProductImage(item) ? 
                          `<img src="${this.getProductImage(item)}" alt="${this.getProductName(item)}">` : 
                          `<div style="width:70px;height:70px;background:#e2e8f0;border-radius:8px;"></div>`
                        }
                      </td>
                      <td class="item-details">
                        <div class="item-name">${this.getProductName(item)}</div>
                        <div class="item-variant">
                          ${this.getVariantDetails(item)}
                        </div>
                        <div class="item-variant">Quantity: ${item.quantity || 1}</div>
                        <div class="item-price">${this.formatPrice(item.price)}</div>
                      </td>
                    </tr>
                  `).join('')}
                </table>
              </div>
              
              <!-- Order Summary -->
              <div class="section">
                <h2 class="section-title">Order Summary</h2>
                <div class="totals">
                  <div class="total-row">
                    <span>Subtotal</span>
                    <span>${this.formatPrice(order.subtotal)}</span>
                  </div>
                  <div class="total-row">
                    <span>Tax</span>
                    <span>${this.formatPrice(order.tax)}</span>
                  </div>
                  <div class="total-row">
                    <span>Shipping (${order.shippingMethod || 'Standard'})</span>
                    <span>${this.formatPrice(order.shipping)}</span>
                  </div>
                  ${order.discount > 0 ? `
                  <div class="total-row">
                    <span>Discount</span>
                    <span>-${this.formatPrice(order.discount)}</span>
                  </div>
                  ` : ''}
                  <div class="total-row final">
                    <span>Total</span>
                    <span>${this.formatPrice(order.total)}</span>
                  </div>
                </div>
              </div>
              
              <!-- Shipping Address -->
              <div class="section">
                <h2 class="section-title">Shipping Address</h2>
                <div class="address-box">
                  <div class="address-name">${order.shippingAddress?.firstName || ''} ${order.shippingAddress?.lastName || ''}</div>
                  <div class="address-line">${order.shippingAddress?.street || ''} ${order.shippingAddress?.apartment ? `, ${order.shippingAddress.apartment}` : ''}</div>
                  <div class="address-line">${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} ${order.shippingAddress?.zipCode || ''}</div>
                  <div class="address-line">${order.shippingAddress?.country || ''}</div>
                  <div class="address-line">📞 ${order.shippingAddress?.phone || ''}</div>
                  <div class="address-line">✉️ ${order.shippingAddress?.email || ''}</div>
                </div>
              </div>
              
              <!-- Billing Address (if different) -->
              ${order.billingAddress && order.billingAddress !== order.shippingAddress ? `
              <div class="section">
                <h2 class="section-title">Billing Address</h2>
                <div class="address-box">
                  <div class="address-name">${order.billingAddress?.firstName || ''} ${order.billingAddress?.lastName || ''}</div>
                  <div class="address-line">${order.billingAddress?.street || ''} ${order.billingAddress?.apartment ? `, ${order.billingAddress.apartment}` : ''}</div>
                  <div class="address-line">${order.billingAddress?.city || ''}, ${order.billingAddress?.state || ''} ${order.billingAddress?.zipCode || ''}</div>
                  <div class="address-line">${order.billingAddress?.country || ''}</div>
                </div>
              </div>
              ` : ''}
              
              <!-- Payment Method -->
              <div class="section">
                <h2 class="section-title">Payment Method</h2>
                <div class="address-box">
                  <div class="address-name">
                    ${order.payment?.method === 'stripe' ? '💳 Credit/Debit Card (via Stripe)' : 
                      order.payment?.method === 'paypal' ? '💳 PayPal' :
                      order.payment?.method === 'klarna' ? '🛒 Klarna' : 
                      order.payment?.method === 'afterpay' ? '💰 Afterpay' : 
                      order.payment?.method || 'Credit Card'}
                  </div>
                  ${order.payment?.transactionId ? `<div class="address-line">Transaction ID: ${order.payment.transactionId}</div>` : ''}
                  <div class="address-line">Status: ${order.payment?.status || 'Pending'}</div>
                </div>
              </div>
              
              <!-- Action Button -->
              <div style="text-align: center;">
                <a href="${CLIENT_URL}/account/orders/${order.orderNumber || order.id}" class="button">View Order Status</a>
              </div>
              
              <!-- Help Text -->
              <div class="help-text">
                <p>Need help? Contact our support team at <a href="mailto:support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com" style="color:#3b82f6;">support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com</a></p>
                <p>We'll send another email when your order ships with tracking information.</p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `🎁 Order Confirmation - #${order.orderNumber} - ${APP_NAME}`,
        html,
        priority: "high",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send order confirmation email:', error);
      throw error;
    }
  }

  async sendOrderStatusUpdate(email, customerName, order) {
    try {
      const statusMessages = {
        'pending': 'is pending',
        'confirmed': 'has been confirmed',
        'processing': 'is being processed',
        'shipped': 'has been shipped',
        'delivered': 'has been delivered',
        'cancelled': 'has been cancelled',
        'refunded': 'has been refunded'
      };

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Status Update - ${order.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #10b981 0%, #34d399 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .order-number { font-size: 24px; font-weight: 600; margin: 20px 0 10px; }
            .order-date { font-size: 16px; opacity: 0.9; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .status-badge { display: inline-block; background: #dcfce7; color: #059669; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; margin: 10px 0 30px; }
            .section { margin-bottom: 35px; }
            .section-title { color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
            .info-box { background: #f8fafc; padding: 20px; border-radius: 8px; margin-top: 10px; }
            .info-title { font-weight: 600; color: #1e293b; margin-bottom: 8px; }
            .info-line { color: #64748b; line-height: 1.5; margin-bottom: 5px; }
            .tracking-number { font-size: 18px; font-weight: 600; color: #3b82f6; margin: 15px 0; }
            .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
            .button:hover { background: linear-gradient(135deg, #059669 0%, #10b981 100%); }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .help-text { margin-top: 20px; font-size: 14px; color: #94a3b8; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1 class="order-number">Order #${order.orderNumber}</h1>
              <p class="order-date">Updated on ${this.formatDate(new Date())}</p>
            </div>
            
            <div class="content">
              <p class="greeting">Hello ${customerName},</p>
              <p>Your order ${statusMessages[order.status] || 'status has been updated'}.</p>
              
              <div class="status-badge">
                Status: ${(order.status || '').charAt(0).toUpperCase() + (order.status || '').slice(1)}
              </div>
              
              <!-- Status Details -->
              <div class="section">
                <h2 class="section-title">Order Update Details</h2>
                <div class="info-box">
                  <div class="info-title">Current Status</div>
                  <div class="info-line">
                    <strong>${(order.status || '').charAt(0).toUpperCase() + (order.status || '').slice(1)}</strong>
                  </div>
                  
                  ${order.trackingNumber ? `
                  <div class="tracking-number">
                    Tracking Number: ${order.trackingNumber}
                  </div>
                  ` : ''}
                  
                  ${order.carrier ? `
                  <div class="info-line">
                    Carrier: ${order.carrier}
                  </div>
                  ` : ''}
                  
                  ${order.estimatedDelivery ? `
                  <div class="info-line">
                    Estimated Delivery: ${this.formatDate(order.estimatedDelivery)}
                  </div>
                  ` : ''}
                </div>
              </div>
              
              <!-- Order Summary -->
              <div class="section">
                <h2 class="section-title">Order Summary</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Number:</span>
                    <span>${order.orderNumber}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Date:</span>
                    <span>${this.formatDate(order.createdAt)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Total:</span>
                    <span>${this.formatPrice(order.total)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span>Payment:</span>
                    <span>${order.payment?.method || 'Credit Card'} (${order.payment?.status || 'Unknown'})</span>
                  </div>
                </div>
              </div>
              
              <!-- Shipping Address -->
              <div class="section">
                <h2 class="section-title">Shipping Address</h2>
                <div class="info-box">
                  <div class="info-title">${order.shippingAddress?.firstName || ''} ${order.shippingAddress?.lastName || ''}</div>
                  <div class="info-line">${order.shippingAddress?.street || ''} ${order.shippingAddress?.apartment ? `, ${order.shippingAddress.apartment}` : ''}</div>
                  <div class="info-line">${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} ${order.shippingAddress?.zipCode || ''}</div>
                  <div class="info-line">${order.shippingAddress?.country || ''}</div>
                </div>
              </div>
              
              <!-- Action Button -->
              <div style="text-align: center;">
                <a href="${CLIENT_URL}/account/orders/${order.orderNumber || order.id}" class="button">View Full Order Details</a>
              </div>
              
              <!-- Next Steps -->
              <div class="section">
                <h2 class="section-title">What's Next?</h2>
                ${order.status === 'shipped' ? `
                <p>Your order is on the way! You can track your package using the tracking number above.</p>
                ` : order.status === 'delivered' ? `
                <p>Your order has been delivered. We hope you love your purchase!</p>
                ` : order.status === 'processing' ? `
                <p>We're preparing your order for shipment. You'll receive another email with tracking information once it ships.</p>
                ` : `
                <p>We'll keep you updated on your order status.</p>
                `}
              </div>
              
              <!-- Help Text -->
              <div class="help-text">
                <p>Need help? Contact our support team at <a href="mailto:support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com" style="color:#10b981;">support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com</a></p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `📦 Order Status Updated: ${order.orderNumber} - ${APP_NAME}`,
        html,
        priority: "high",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send order status update email:', error);
      throw error;
    }
  }

  async sendShippingNotification(email, customerName, order) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Order Has Shipped! - ${order.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .order-number { font-size: 24px; font-weight: 600; margin: 20px 0 10px; }
            .order-date { font-size: 16px; opacity: 0.9; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .tracking-number { font-size: 24px; font-weight: 700; color: #f59e0b; text-align: center; margin: 30px 0; letter-spacing: 1px; }
            .status-badge { display: inline-block; background: #fef3c7; color: #d97706; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; margin: 10px 0 30px; }
            .section { margin-bottom: 35px; }
            .section-title { color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
            .info-box { background: #f8fafc; padding: 20px; border-radius: 8px; margin-top: 10px; }
            .info-title { font-weight: 600; color: #1e293b; margin-bottom: 8px; }
            .info-line { color: #64748b; line-height: 1.5; margin-bottom: 5px; }
            .button { display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
            .button:hover { background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%); }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .help-text { margin-top: 20px; font-size: 14px; color: #94a3b8; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1 class="order-number">It's On The Way! 🚚</h1>
              <p class="order-date">Order #${order.orderNumber} has shipped</p>
            </div>
            
            <div class="content">
              <p class="greeting">Hello ${customerName},</p>
              <p>Great news! Your order has shipped and is on its way to you.</p>
              
              <div class="tracking-number">
                ${order.trackingNumber || 'Tracking number will be updated soon'}
              </div>
              
              <div class="status-badge">
                Shipped via ${order.carrier || order.shippingMethod || 'Standard Shipping'}
              </div>
              
              <!-- Tracking Details -->
              <div class="section">
                <h2 class="section-title">Tracking Information</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Tracking Number:</span>
                    <span style="font-weight: 600;">${order.trackingNumber || 'Pending'}</span>
                  </div>
                  ${order.carrier ? `
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Carrier:</span>
                    <span>${order.carrier}</span>
                  </div>
                  ` : ''}
                  ${order.estimatedDelivery ? `
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Estimated Delivery:</span>
                    <span>${this.formatDate(order.estimatedDelivery)}</span>
                  </div>
                  ` : ''}
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span>Shipping Method:</span>
                    <span>${order.shippingMethod || 'Standard'}</span>
                  </div>
                </div>
              </div>
              
              <!-- Order Summary -->
              <div class="section">
                <h2 class="section-title">Order Summary</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Number:</span>
                    <span>${order.orderNumber}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Shipped On:</span>
                    <span>${this.formatDate(new Date())}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span>Destination:</span>
                    <span>${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''}</span>
                  </div>
                </div>
              </div>
              
              <!-- Shipping Address -->
              <div class="section">
                <h2 class="section-title">Shipping To</h2>
                <div class="info-box">
                  <div class="info-title">${order.shippingAddress?.firstName || ''} ${order.shippingAddress?.lastName || ''}</div>
                  <div class="info-line">${order.shippingAddress?.street || ''} ${order.shippingAddress?.apartment ? `, ${order.shippingAddress.apartment}` : ''}</div>
                  <div class="info-line">${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} ${order.shippingAddress?.zipCode || ''}</div>
                  <div class="info-line">${order.shippingAddress?.country || ''}</div>
                </div>
              </div>
              
              <!-- Action Buttons -->
              <div style="text-align: center;">
                <a href="${CLIENT_URL}/account/orders/${order.orderNumber || order.id}" class="button">Track Your Package</a>
                ${order.trackingNumber ? `
                <p style="margin-top: 10px; font-size: 14px; color: #64748b;">
                  <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${order.trackingNumber}" style="color: #f59e0b; text-decoration: none;">
                    › Track on Carrier Website
                  </a>
                </p>
                ` : ''}
              </div>
              
              <!-- Delivery Tips -->
              <div class="section">
                <h2 class="section-title">Delivery Tips</h2>
                <div class="info-box">
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">1. Tracking Updates</div>
                    <div class="info-line">You can track your package using the tracking number above.</div>
                  </div>
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">2. Delivery Attempt</div>
                    <div class="info-line">Carrier will attempt delivery during business hours.</div>
                  </div>
                  <div style="padding: 8px 0;">
                    <div class="info-title">3. Contacting You</div>
                    <div class="info-line">The carrier may contact you at: ${order.shippingAddress?.phone || 'Phone number on file'}</div>
                  </div>
                </div>
              </div>
              
              <!-- Help Text -->
              <div class="help-text">
                <p>If you have any questions about your delivery, please contact the carrier directly using the tracking number above, or reach out to us at <a href="mailto:support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com" style="color:#f59e0b;">support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com</a></p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `📦 Your ${APP_NAME} Order Has Shipped! #${order.orderNumber}`,
        html,
        priority: "high",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send shipping notification email:', error);
      throw error;
    }
  }

  async sendOrderDeliveredNotification(email, customerName, order) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Order Has Been Delivered! - ${order.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #10b981 0%, #34d399 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .order-number { font-size: 24px; font-weight: 600; margin: 20px 0 10px; }
            .order-date { font-size: 16px; opacity: 0.9; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .delivery-icon { font-size: 48px; text-align: center; margin: 30px 0; }
            .status-badge { display: inline-block; background: #d1fae5; color: #059669; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; margin: 10px 0 30px; }
            .section { margin-bottom: 35px; }
            .section-title { color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
            .info-box { background: #f8fafc; padding: 20px; border-radius: 8px; margin-top: 10px; }
            .info-title { font-weight: 600; color: #1e293b; margin-bottom: 8px; }
            .info-line { color: #64748b; line-height: 1.5; margin-bottom: 5px; }
            .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
            .button:hover { background: linear-gradient(135deg, #059669 0%, #10b981 100%); }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .help-text { margin-top: 20px; font-size: 14px; color: #94a3b8; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1 class="order-number">Delivered! ✅</h1>
              <p class="order-date">Order #${order.orderNumber}</p>
            </div>
            
            <div class="content">
              <div class="delivery-icon">
                📦 ✅
              </div>
              
              <p class="greeting">Hello ${customerName},</p>
              <p>Your order has been successfully delivered!</p>
              
              <div class="status-badge">
                Status: Delivered ✅
              </div>
              
              <!-- Delivery Details -->
              <div class="section">
                <h2 class="section-title">Delivery Confirmation</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Number:</span>
                    <span>${order.orderNumber}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Delivered On:</span>
                    <span>${this.formatDate(new Date())}</span>
                  </div>
                  ${order.trackingNumber ? `
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Tracking Number:</span>
                    <span>${order.trackingNumber}</span>
                  </div>
                  ` : ''}
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span>Delivery Location:</span>
                    <span>${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''}</span>
                  </div>
                </div>
              </div>
              
              <!-- What's Next -->
              <div class="section">
                <h2 class="section-title">What's Next?</h2>
                <div class="info-box">
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">1. Check Your Items</div>
                    <div class="info-line">Please inspect your items to ensure everything is correct and undamaged.</div>
                  </div>
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">2. Need Help?</div>
                    <div class="info-line">If you have any issues with your order, please contact us within 30 days.</div>
                  </div>
                  <div style="padding: 8px 0;">
                    <div class="info-title">3. Leave a Review</div>
                    <div class="info-line">Share your experience by leaving a review for the products you purchased.</div>
                  </div>
                </div>
              </div>
              
              <!-- Action Button -->
              <div style="text-align: center;">
                <a href="${CLIENT_URL}/account/orders/${order.orderNumber || order.id}" class="button">View Order Details</a>
                <p style="margin-top: 10px;">
                  <a href="${CLIENT_URL}/products" style="color: #10b981; text-decoration: none; font-weight: 500;">
                    › Continue Shopping
                  </a>
                </p>
              </div>
              
              <!-- Help Text -->
              <div class="help-text">
                <p>If there are any issues with your delivery, please contact us within 24 hours at <a href="mailto:support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com" style="color:#10b981;">support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com</a></p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `📦 Your ${APP_NAME} Order Has Been Delivered! #${order.orderNumber}`,
        html,
        priority: "normal",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send order delivered notification email:', error);
      throw error;
    }
  }

  async sendPaymentConfirmation(email, name, order) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Payment Confirmed - ${APP_NAME}</h2>
            <p>Hello ${name},</p>
            <p>Your payment for order ${order.orderNumber} has been successfully processed.</p>
            <p><strong>Amount:</strong> ${this.formatPrice(order.total)}</p>
            <p>Your order is now being prepared for shipment.</p>
            <p>Thank you for shopping with us!</p>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Payment Confirmed - Order ${order.orderNumber}`,
        html,
        priority: "normal",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send payment confirmation email:', error);
      throw error;
    }
  }

  async sendOrderCancellation(email, name, order, reason) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Order Cancelled - ${APP_NAME}</h2>
            <p>Hello ${name},</p>
            <p>Your order ${order.orderNumber} has been cancelled.</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
            <p>If you have any questions, please contact our support team.</p>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Order Cancelled - ${order.orderNumber}`,
        html,
        priority: "normal",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send order cancellation email:', error);
      throw error;
    }
  }

  async sendPaymentFailure(email, name, order) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Payment Failed - ${APP_NAME}</h2>
            <p>Hello ${name},</p>
            <p>We were unable to process your payment for order ${order.orderNumber}.</p>
            <p>Please check your payment information and try again, or contact your bank.</p>
            <p>If you continue to experience issues, please contact our support team.</p>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Payment Failed - Order ${order.orderNumber}`,
        html,
        priority: "high",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send payment failure email:', error);
      throw error;
    }
  }

  async sendVerificationEmail(email, name, token) {
    try {
      const verificationUrl = `${CLIENT_URL}/verify-email?token=${token}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #007bff; 
                     color: white; text-decoration: none; border-radius: 4px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; 
                     color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Verify Your Email Address</h2>
            <p>Hello ${name},</p>
            <p>Thank you for registering with ${APP_NAME}. Please verify your email address by clicking the button below:</p>
            <p><a href="${verificationUrl}" class="button">Verify Email</a></p>
            <p>Or copy and paste this link in your browser:<br>${verificationUrl}</p>
            <p>This verification link will expire in 24 hours.</p>
            <div class="footer">
              <p>If you didn't create an account with us, please ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Verify Your Email - ${APP_NAME}`,
        html,
        text: `Please verify your email by visiting: ${verificationUrl}\nThis link expires in 24 hours.`,
        priority: "high",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Verification email sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send verification email:", error);
      throw error;
    }
  }

  async sendPasswordChangeConfirmation(email, name) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; 
                     color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Password Changed Successfully</h2>
            <p>Hello ${name},</p>
            <p>Your password has been successfully changed for your ${APP_NAME} account.</p>
            <p>If you did not make this change, please contact our support team immediately.</p>
            <div class="footer">
              <p>Thank you for using ${APP_NAME}!</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Password Changed - ${APP_NAME}`,
        html,
        text: "Your password has been successfully changed. If you didn't make this change, please contact support.",
        priority: "normal",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Password change confirmation sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send password change confirmation:", error);
      throw error;
    }
  }

  async sendAccountDeactivationEmail(email, name) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; 
                     color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Account Deactivated</h2>
            <p>Hello ${name},</p>
            <p>Your ${APP_NAME} account has been deactivated by an administrator.</p>
            <p>If you believe this was done in error, please contact our support team.</p>
            <div class="footer">
              <p>Thank you for using ${APP_NAME}!</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Account Deactivated - ${APP_NAME}`,
        html,
        text: "Your account has been deactivated by an administrator. Contact support if this was an error.",
        priority: "normal",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Account deactivation email sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send account deactivation email:", error);
      throw error;
    }
  }

  async sendAccountReactivationEmail(email, name) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; 
                     color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Account Reactivated</h2>
            <p>Hello ${name},</p>
            <p>Your ${APP_NAME} account has been reactivated by an administrator.</p>
            <p>You can now log in and use our services as usual.</p>
            <div class="footer">
              <p>Welcome back to ${APP_NAME}!</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Account Reactivated - ${APP_NAME}`,
        html,
        text: "Your account has been reactivated by an administrator. You can now log in and use our services.",
        priority: "normal",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Account reactivation email sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send account reactivation email:", error);
      throw error;
    }
  }

  async sendPasswordResetEmail(email, name, token) {
    try {
      const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password - ${APP_NAME}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .button { display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
            .button:hover { background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .help-text { margin-top: 20px; font-size: 14px; color: #94a3b8; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1>Reset Your Password</h1>
            </div>
            
            <div class="content">
              <p class="greeting">Hello ${name},</p>
              <p>We received a request to reset your password for your ${APP_NAME} account.</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              
              <p style="text-align: center; font-size: 14px; color: #64748b;">
                Or copy and paste this link:<br>
                <span style="word-break: break-all; color: #8b5cf6;">${resetUrl}</span>
              </p>
              
              <div class="help-text">
                <p>This password reset link will expire in 1 hour.</p>
                <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Reset Your Password - ${APP_NAME}`,
        html,
        text: `Reset your password by visiting: ${resetUrl}\nThis link expires in 1 hour.`,
        priority: "high",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Password reset email sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send password reset email:", error);
      throw error;
    }
  }

  async sendPasswordResetConfirmation(email, name) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Successful - ${APP_NAME}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #10b981 0%, #34d399 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .success-icon { font-size: 48px; text-align: center; margin: 30px 0; color: #10b981; }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1>Password Reset Successful</h1>
            </div>
            
            <div class="content">
              <div class="success-icon">
                ✅
              </div>
              
              <p class="greeting">Hello ${name},</p>
              <p>Your password has been successfully reset for your ${APP_NAME} account.</p>
              <p>You can now log in with your new password.</p>
              
              <div style="text-align: center; margin-top: 30px;">
                <a href="${CLIENT_URL}/login" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500;">
                  Log In Now
                </a>
              </div>
              
              <div style="margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 8px;">
                <p style="color: #64748b; font-size: 14px;">
                  <strong>Security Tip:</strong> If you didn't request this password reset, please contact our support team immediately.
                </p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `Password Reset Successful - ${APP_NAME}`,
        html,
        text: "Your password has been successfully reset. If you didn't make this change, please contact support immediately.",
        priority: "normal",
      };

      const info = await this.sendEmail(mailOptions);
      console.log("Password reset confirmation sent to:", email);
      return info;
    } catch (error) {
      console.error("Failed to send password reset confirmation:", error);
      throw error;
    }
  }

  async sendOrderRefund(email, customerName, order, refundAmount, reason) {
    try {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Refund Processed - ${order.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f7fafc; }
            .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); padding: 40px 30px; text-align: center; color: white; }
            .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
            .order-number { font-size: 24px; font-weight: 600; margin: 20px 0 10px; }
            .order-date { font-size: 16px; opacity: 0.9; }
            .content { padding: 40px 30px; }
            .greeting { color: #1e293b; font-size: 18px; margin-bottom: 25px; }
            .refund-amount { font-size: 36px; font-weight: 700; color: #10b981; text-align: center; margin: 30px 0; }
            .status-badge { display: inline-block; background: #f3e8ff; color: #8b5cf6; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; margin: 10px 0 30px; }
            .section { margin-bottom: 35px; }
            .section-title { color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
            .info-box { background: #f8fafc; padding: 20px; border-radius: 8px; margin-top: 10px; }
            .info-title { font-weight: 600; color: #1e293b; margin-bottom: 8px; }
            .info-line { color: #64748b; line-height: 1.5; margin-bottom: 5px; }
            .button { display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
            .button:hover { background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); }
            .footer { background: #f1f5f9; padding: 30px; text-align: center; color: #64748b; font-size: 14px; border-top: 1px solid #e2e8f0; }
            .help-text { margin-top: 20px; font-size: 14px; color: #94a3b8; }
            @media (max-width: 600px) { .content, .header { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="logo">${APP_NAME}</div>
              <h1 class="order-number">Refund Processed</h1>
              <p class="order-date">Order #${order.orderNumber}</p>
            </div>
            
            <div class="content">
              <p class="greeting">Hello ${customerName},</p>
              <p>We've processed a refund for your order. Here are the details:</p>
              
              <div class="refund-amount">
                ${this.formatPrice(refundAmount)}
              </div>
              
              <div class="status-badge">
                Refund Status: ${refundAmount >= order.total ? 'Fully Refunded' : 'Partially Refunded'}
              </div>
              
              <!-- Refund Details -->
              <div class="section">
                <h2 class="section-title">Refund Details</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Number:</span>
                    <span>${order.orderNumber}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Original Amount:</span>
                    <span>${this.formatPrice(order.total)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Refund Amount:</span>
                    <span style="color: #10b981; font-weight: 600;">${this.formatPrice(refundAmount)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Refund Date:</span>
                    <span>${this.formatDate(new Date())}</span>
                  </div>
                  ${reason ? `
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">Reason</div>
                    <div class="info-line">${reason}</div>
                  </div>
                  ` : ''}
                  <div style="padding: 8px 0;">
                    <div class="info-title">Payment Method</div>
                    <div class="info-line">${order.payment?.method || 'Credit Card'}</div>
                    <div class="info-line" style="font-size: 13px; color: #94a3b8;">
                      The refund will appear on your original payment method within 5-10 business days.
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Order Summary -->
              <div class="section">
                <h2 class="section-title">Order Summary</h2>
                <div class="info-box">
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <span>Order Date:</span>
                    <span>${this.formatDate(order.createdAt)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                    <span>Items:</span>
                    <span>${order.items?.length || 0} item${order.items?.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
              
              <!-- Action Button -->
              <div style="text-align: center;">
                <a href="${CLIENT_URL}/account/orders/${order.orderNumber || order.id}" class="button">View Order Details</a>
              </div>
              
              <!-- Timeline -->
              <div class="section">
                <h2 class="section-title">Refund Timeline</h2>
                <div class="info-box">
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">1. Refund Initiated</div>
                    <div class="info-line">We've processed your refund request.</div>
                  </div>
                  <div style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                    <div class="info-title">2. Processing by Bank</div>
                    <div class="info-line">Your bank is now processing the refund.</div>
                  </div>
                  <div style="padding: 8px 0;">
                    <div class="info-title">3. Funds Returned</div>
                    <div class="info-line">Amount will appear in your account within 5-10 business days.</div>
                  </div>
                </div>
              </div>
              
              <!-- Help Text -->
              <div class="help-text">
                <p>If you don't see the refund in your account after 10 business days, please contact your bank first, then reach out to us at <a href="mailto:support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com" style="color:#8b5cf6;">support@${APP_NAME.toLowerCase().replace(/\s+/g, '')}.com</a></p>
              </div>
            </div>
            
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
              <p>This is an automated email. Please do not reply to this message.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        to: email,
        subject: `💰 Refund Processed: ${this.formatPrice(refundAmount)} - ${APP_NAME}`,
        html,
        priority: "high",
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Failed to send order refund email:', error);
      throw error;
    }
  }

  /* ------------------------- Shutdown ------------------------- */

  async shutdown() {
    for (const transporter of this.transporters) {
      await transporter.pool.drain();
      await transporter.pool.clear();
    }
  }
}

// Singleton instance
const emailService = new EmailService();

// Graceful shutdown
process.on("SIGTERM", () => emailService.shutdown());
process.on("SIGINT", () => emailService.shutdown());

module.exports = { emailService };