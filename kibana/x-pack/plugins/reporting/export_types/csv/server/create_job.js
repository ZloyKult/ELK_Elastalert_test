import { oncePerServer } from '../../../server/lib/once_per_server';
import { cryptoFactory } from '../../../server/lib/crypto';

function createJobFn(server) {
  const crypto = cryptoFactory(server);

  return async function createJob(jobParams, headers, request) {
    const serializedEncryptedHeaders = await crypto.encrypt(headers);

    const savedObjectsClient = request.getSavedObjectsClient();
    const indexPatternSavedObject = await savedObjectsClient.get(
      'index-pattern',
      jobParams.indexPatternId);

    return {
      headers: serializedEncryptedHeaders,
      indexPatternSavedObject: indexPatternSavedObject,
      ...jobParams
    };
  };
}

export const createJobFactory = oncePerServer(createJobFn);
