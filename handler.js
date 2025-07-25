import awsServerlessExpress from 'aws-serverless-express';
import app from './lib/app.js'; // Import the Express app from lib/app.js
import loggers from 'namespaced-console-logger';

const logger = loggers().get('handler', process.env.LOG_LEVEL || 'info');

const server = awsServerlessExpress.createServer(app);

export const handler = (event, context) => {
  return awsServerlessExpress.proxy(server, event, context);
};