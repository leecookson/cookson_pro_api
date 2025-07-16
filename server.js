import winston from 'winston';
import loggers from 'namespaced-console-logger';
import app from './lib/app.js'; // Import the Express app

// --- Application Logger Setup ---
// Create a root logger instance
const logger = loggers().get('server');

const PORT = process.env.PORT || 3000;

// --- Start Server ---
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Access logs are being written to logs/access.log`);
});
