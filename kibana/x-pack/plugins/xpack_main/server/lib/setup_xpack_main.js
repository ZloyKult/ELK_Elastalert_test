import { injectXPackInfoSignature } from './inject_xpack_info_signature';
import { XPackInfo } from './xpack_info';

/**
 * Setup the X-Pack Main plugin. This is fired every time that the Elasticsearch plugin becomes Green.
 *
 * This will ensure that X-Pack is installed on the Elasticsearch cluster, as well as trigger the initial
 * polling for _xpack/info.
 *
 * @param server {Object} The Kibana server object.
 */
export function setupXPackMain(server) {
  const info = new XPackInfo(server, {
    pollFrequencyInMillis: server.config().get('xpack.xpack_main.xpack_api_polling_frequency_millis')
  });

  server.expose('info', info);
  server.expose('createXPackInfo', (options) => new XPackInfo(server, options));
  server.ext('onPreResponse', (request, reply) => injectXPackInfoSignature(info, request, reply));
  server.plugins.elasticsearch.status.on('change', async () => {
    await info.refreshNow();

    if (info.isAvailable()) {
      server.plugins.xpack_main.status.green('Ready');
    } else {
      server.plugins.xpack_main.status.red(info.unavailableReason());
    }
  });
}
