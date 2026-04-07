// visitorHelper.js
const useragent = require('useragent'); // You'll need to install: npm install useragent
const requestIp = require('request-ip'); // You'll need to install: npm install request-ip
const geoip = require('geoip-lite'); // You'll need to install: npm install geoip-lite

const createVisitorData = (req, pageVisited) => {
  const agent = useragent.parse(req.headers['user-agent']);
  const ip = requestIp.getClientIp(req);
  const geo = geoip.lookup(ip);
  
  // Determine device type
  let deviceType = 'unknown';
  let isMobile = false;
  let isTablet = false;
  let isDesktop = false;
  
  const ua = req.headers['user-agent'].toLowerCase();
  if (ua.includes('mobile')) {
    deviceType = 'mobile';
    isMobile = true;
  } else if (ua.includes('tablet')) {
    deviceType = 'tablet';
    isTablet = true;
  } else if (ua.includes('bot')) {
    deviceType = 'bot';
  } else {
    deviceType = 'desktop';
    isDesktop = true;
  }

  return {
    ipAddress: ip,
    visitDateTime: new Date(),
    userAgent: req.headers['user-agent'],
    referrer: req.headers.referer || req.headers.referrer || '',
    pageVisited: pageVisited,
    country: geo ? geo.country : '',
    city: geo ? geo.city : '',
    region: geo ? geo.region : '',
    browser: {
      name: agent.family,
      version: agent.toVersion()
    },
    os: {
      name: agent.os.family,
      version: agent.os.toVersion()
    },
    device: {
      type: deviceType,
      isMobile,
      isTablet,
      isDesktop
    },
    sessionId: req.sessionID || Math.random().toString(36).substr(2, 9)
  };
};

module.exports = { createVisitorData };