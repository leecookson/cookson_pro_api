import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';

console.error('LOG_LEVEL', process.env.LOG_LEVEL);
test.describe('Astronomy API (/api/v1/astro)', () => {

  // Test for a successful search by term
  test.it('should return 200 and astronomy data for a valid term search', async (t) => {
    const mockParams = { term: 'Orion' };
    const mockAstroData = {
      data: [{
        id: 'M42',
        name: 'Orion Nebula',
        type: 'Nebula',
        ra: 5.5833,
        dec: -5.3833
      }],
      metadata: { total: 1 }
    };

    // Mock the service call to expect parameters as they would be parsed from a query string
    // For GET requests, supertest's .query() method handles this, and the service receives a plain object.
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const expectedUrl = `https://api.astronomyapi.com/api/v2/search?term=${encodeURIComponent(mockParams.term)}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');
      assert.ok(options.headers.Authorization.startsWith('Basic '), 'Authorization header should be present and correct.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockAstroData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });


    const response = await supertest(app)
      .get('/api/v1/astro/search')
      .query(mockParams) // Use .query() for GET requests
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockAstroData, 'Response body should match mocked data');
  });

  // Test for a successful search by RA/DEC
  test.it('should return 200 and astronomy data for a valid RA/DEC search', async (t) => {
    const mockParams = { ra: 10.123, dec: 20.456 };
    const mockAstroData = {
      data: [{
        name: 'Test Star',
        type: 'Star',
        ra: 10.123,
        dec: 20.456
      }],
      metadata: { total: 1 }
    };

    // Mock the service call to expect parameters as they would be parsed from a query string
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const expectedUrl = `https://api.astronomyapi.com/api/v2/search?ra=${mockParams.ra}&dec=${mockParams.dec}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');
      assert.ok(options.headers.Authorization.startsWith('Basic '), 'Authorization header should be present and correct.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockAstroData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await supertest(app)
      .get('/api/v1/astro/search')
      .query(mockParams) // Use .query() for GET requests
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockAstroData, 'Response body should match mocked data');
  });

  // --- Parameter Validation Tests ---

  test.it('should return 400 if no parameters are provided', async () => {
    // For GET, an empty query string is equivalent to no parameters
    await supertest(app)
      .get('/api/v1/astro/search')
      .expect(400)
      .then(res => {
        assert.strictEqual(res.body.error, 'Invalid parameters: Either "term" or both "ra" and "dec" must be provided.');
      });
  });

  test.it('should return 400 if only "ra" is provided without "dec"', async () => {
    await supertest(app)
      .get('/api/v1/astro/search')
      .query({ ra: 10.123 })
      .expect(400)
      .then(res => {
        assert.strictEqual(res.body.error, 'Invalid parameters: Either "term" or both "ra" and "dec" must be provided.');
      });
  });

  // Note: The route handler for astro.js already handles validation for 'match_type', 'order_by', 'limit', 'offset', 'ra', 'dec'
  // by checking `error.message.startsWith('Invalid parameters:') || error.message.startsWith('Invalid parameter:')`
  // So, these tests are effectively testing the service's validation, which is then caught by the route.

  test.it('should return 400 for an invalid "match_type"', async () => {
    await supertest(app)
      .get('/api/v1/astro/search')
      .query({ term: 'Andromeda', match_type: 'incorrect' })
      .expect(400)
      .then(res => {
        assert.strictEqual(res.body.error, 'Invalid parameter: "match_type" must be "fuzzy" or "exact".');
      });
  });

  test.it('should return 400 for an invalid "limit"', async () => {
    await supertest(app)
      .get('/api/v1/astro/search')
      .query({ term: 'Galaxy', limit: -5 })
      .expect(400)
      .then(res => {
        assert.strictEqual(res.body.error, 'Invalid parameter: "limit" must be a positive integer.');
      });
  });

  // Test for "order_by" with RA/DEC is already covered by the service's validation,
  // which the route catches and returns 400.

  // --- Service Behavior Tests ---

  test.it('should return 404 if the service finds no matching objects', async (t) => {
    const mockParams = { term: 'NonExistentObject123' };
    // Mock the global fetch function to return an empty data array,
    // which the service interprets as no matching objects.
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const expectedUrl = `https://api.astronomyapi.com/api/v2/search?term=${encodeURIComponent(mockParams.term)}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');
      assert.ok(options.headers.Authorization.startsWith('Basic '), 'Authorization header should be present and correct.');

      return new Response(JSON.stringify({ data: [], metadata: { total: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await supertest(app)
      .get('/api/v1/astro/search').query(mockParams)
      .expect(404)
      .then(res => {
        assert.strictEqual(res.body.message, 'No celestial objects found matching the criteria.');
      });
  });

  test.it('should return 500 if the service throws an unexpected error', async (t) => {
    const mockParams = { term: 'ErrorTrigger' };
    // Mock fetch to simulate an external API failure (e.g., network error, 500 from upstream)
    t.mock.method(globalThis, 'fetch', async () => {
      // Simulate a network error or an unhandled 500 from the external API
      throw new Error('Failed to fetch');
    });

    // Use .query() for GET requests
    const response = await supertest(app)
      .get('/api/v1/astro/search')
      .query(mockParams)
      .expect(500);

    assert.strictEqual(response.text, 'Something broke!');
  });

  // --- Tests Demonstrating Fetch Mocking ---

  test.it('should return 200 by mocking fetch for a valid search', async (t) => {
    const mockParams = { term: 'Andromeda' };
    const mockApiResponse = {
      data: [{ name: 'Andromeda Galaxy' }],
      metadata: { total: 1 }
    };

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const expectedUrl = `https://api.astronomyapi.com/api/v2/search?term=Andromeda`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');
      assert.ok(options.headers.Authorization.startsWith('Basic '), 'Authorization header should be present and correct.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockApiResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // This test now goes through the route to the *actual* service.
    // The service's `fetch` call is intercepted by our mock above.
    const response = await supertest(app)
      .get('/api/v1/astro/search')
      .query(mockParams)
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockApiResponse, 'Response body should match the mocked API response');
  });

  test.it('should handle external API errors by mocking fetch to return a non-200 status', async (t) => {
    const mockParams = { term: 'Failure' };

    // Mock fetch to simulate an external API failure
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
    });

    // The service should throw an error, which the app's central error handler catches.
    await supertest(app)
      .get('/api/v1/astro/search')
      .query(mockParams)
      .expect(500);
  });

  // Add an after hook to ensure the process exits cleanly
  test.after(async () => {
    process.exit(0);
  });
});

test.it('should return 200 by mocking fetch for a valid search', async (t) => {
  const mockParams = { term: 'Andromeda' };
  const mockApiResponse = {
    data: [{ name: 'Andromeda Galaxy' }],
    metadata: { total: 1 }
  };

  // Mock the global fetch function
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const expectedUrl = `https://api.astronomyapi.com/api/v2/search?term=Andromeda`;
    assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');
    assert.ok(options.headers.Authorization.startsWith('Basic '), 'Authorization header should be present and correct.');

    // Return a mock Response object
    return new Response(JSON.stringify(mockApiResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  // This test now goes through the route to the *actual* service.
  // The service's `fetch` call is intercepted by our mock above.
  const response = await supertest(app)
    .get('/api/v1/astro/search')
    .query(mockParams)
    .expect(200)
    .expect('Content-Type', /json/);

  assert.deepStrictEqual(response.body, mockApiResponse, 'Response body should match the mocked API response');
});

test.it('should handle external API errors by mocking fetch to return a non-200 status', async (t) => {
  const mockParams = { term: 'Failure' };

  // Mock fetch to simulate an external API failure
  t.mock.method(globalThis, 'fetch', async () => {
    return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
  });

  // The service should throw an error, which the app's central error handler catches.
  await supertest(app)
    .get('/api/v1/astro/search')
    .query(mockParams)
    .expect(500);
});

// Add an after hook to ensure the process exits cleanly
test.after(async () => {
  process.exit(0);
});
