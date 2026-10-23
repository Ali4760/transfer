// functions/src/lib/secrets.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let client: SecretManagerServiceClient | null = null;

export async function getSecret(name: string): Promise<string> {
  if (process.env[name]) {
    return process.env[name] || '';
  }
  try {
    if (!client) {
      client = new SecretManagerServiceClient();
    }
    const [version] = await client.accessSecretVersion({
      name: `projects/${process.env.GCLOUD_PROJECT}/secrets/${name}/versions/latest`,
    });
    return version.payload?.data?.toString() ?? '';
  } catch (err) {
    return '';
  }
}
