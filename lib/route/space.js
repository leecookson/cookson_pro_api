import { Router } from 'express';
const router = Router();
import peopleService from '../service/people.js';
import loggers from 'namespaced-console-logger';
import { SourceUnavailableError, UpstreamError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:space');

/**
 * @openapi
 * /api/v1/space/people:
 *   get:
 *     summary: Everyone in space right now
 *     description: >
 *       Who is in space comes from Launch Library 2; station, spacecraft and crew role from the
 *       corquaid people-in-space feed. If one source fails the other is used alone and the
 *       failure is reported under unavailable.
 *     tags: [Space]
 *     responses:
 *       200:
 *         description: People in space with agency, country, spacecraft, station, role, launch time and days in space
 *       502:
 *         description: Both sources are unavailable and nothing recent is cached
 */
router.get('/people', async (req, res, next) => {
  logger.info('Received people in space request');

  try {
    const data = await peopleService.getPeopleInSpace();
    res.set('Cache-Control', 'public, max-age=600');
    res.json(data);
  } catch (error) {
    next(error instanceof SourceUnavailableError ? new UpstreamError(error.message) : error);
  }
});

export default router;
