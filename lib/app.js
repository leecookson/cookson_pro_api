// Encapsulate all express app setup here, can be called by a typical server.js that handles logging, http server creation, etc.
//    or can be wrapped by AWS Lambda handler for serverless deployment.
import express from 'express';
import cors from 'cors';
import winston from 'winston';
import path from 'path';

import loggers from 'namespaced-console-logger';

const logger = loggers().get('lib:app');

import weatherRoutes from './route/weather.js'; // Correctly import weatherRoutes
import locationRoutes from './route/location.js';

// --- Winston Access Logger Setup ---
const accessLogStream = winston.createLogger({
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
      )
    })
  ]
});

const app = express();
export default app; // Export the app for use in server.js or handler.js

// Middleware for access logging using a format similar to morgan's 'combined'
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const responseTime = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3); // in ms
    const logMessage = `${req.ip} - ${req.user || '-'} [${new Date().toISOString()}] "${req.method} ${req.originalUrl} HTTP/${req.httpVersion}" ${res.statusCode} ${res.get('Content-Length') || '-'} "${req.get('Referrer') || '-'}" "${req.get('User-Agent') || '-'}" - ${responseTime} ms`;
    accessLogStream.info(logMessage);
  });
  next();
});

// --- CORS Setup ---
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if the origin ends with '.cookson.pro'
    // This regex matches origins like http://localhost:3000, http://sub.cookson.pro, https://www.cookson.pro:8080
    if (/(^https?:\/\/.*\.cookson\.pro(:\d+)?$)|(^https?:\/\/localhost(:\d+)?$)/.test(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204 // Some legacy browsers (IE11, various SmartTVs) choke on 200
};
app.use(cors(corsOptions));

// to allow ip/location to be determined correctly behind a proxy
app.set('trust proxy', true)
// --- Middleware for JSON parsing ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Routes ---
app.use('/api/v1/weather', weatherRoutes);
app.use('/api/v1/location', locationRoutes);

// --- Basic Error Handler ---
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).send('Something broke!');
});
