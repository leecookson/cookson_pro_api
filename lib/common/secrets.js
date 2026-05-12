import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('common:secrets');

const secrets = new Map()

// When USE_LOCAL_ENV=true, skip Secrets Manager entirely and require all secrets
// to be present in process.env (set by .env via dotenv, or as real env vars on Servo).
const USE_LOCAL_ENV = process.env.USE_LOCAL_ENV === 'true';

export async function getSecret(secret_name) {
  if (secrets.has(secret_name)) {
    logger.info(`Returning cached secret: ${secret_name}`);
    return secrets.get(secret_name);
  }

  if (process.env[secret_name]) {
    logger.info(`Returning secret from process.env: ${secret_name}`);
    secrets.set(secret_name, process.env[secret_name]);
    return process.env[secret_name];
  }

  if (USE_LOCAL_ENV) {
    throw new Error(`Secret "${secret_name}" not found in environment. Set USE_LOCAL_ENV=true requires all secrets to be present in process.env.`);
  }

  const client = new SecretsManagerClient({
    region: "us-east-1",
  });

  let response;

  try {
    response = await client.send(
      new GetSecretValueCommand({
        SecretId: `/apikeys/${secret_name}`,
        VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
      })
    );
  } catch (error) {
    // For a list of exceptions thrown, see
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    throw error;
  }

  const secret = response.SecretString;
  logger.info(`Retrieved secret: ${secret_name}`);
  secrets.set(secret_name, secret);
  return secret;
}
