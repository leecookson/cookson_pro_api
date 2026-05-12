import loggers from 'namespaced-console-logger';
import app from './lib/app.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('server');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
