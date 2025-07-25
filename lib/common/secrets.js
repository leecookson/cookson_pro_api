import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('common:secrets');

const secrets = new Map()

// for local dev, use .env file, detect process.env first, else use AWS Secrets Manager
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
