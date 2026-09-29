// functions/src/lib/secrets.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export async function getSecret(name: string): Promise<string> {
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GCLOUD_PROJECT}/secrets/${name}/versions/latest`,
  });
  return version.payload?.data?.toString() ?? '';
}
