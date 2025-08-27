import awsServerlessExpress from 'aws-serverless-express';
import app from './lib/app.js'; // Import the Express app from lib/app.js
import loggers from 'namespaced-console-logger';

const logger = loggers().get('handler', process.env.LOG_LEVEL || 'info');

const server = awsServerlessExpress.createServer(app);

export const handler = async (event, context) => {
  logger.info(`Received event: ${event.rawPath}, requestContext.http: ${JSON.stringify(event.requestContext.http)}`);
  // Use the 'PROMISE' resolution mode for async handlers. This returns a promise that resolves with the response.
  return awsServerlessExpress.proxy(server, event, context, 'PROMISE').promise;
};