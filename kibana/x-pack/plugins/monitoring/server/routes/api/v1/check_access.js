import { verifyMonitoringAuth } from '../../../lib/elasticsearch/verify_monitoring_auth';
import { handleError } from '../../../lib/errors';

/*
 * API for checking read privilege on Monitoring Data
 * Used for the "Access Denied" page as something to auto-retry with.
 */
export function checkAccessRoute(server) {
  server.route({
    method: 'GET',
    path: '/api/monitoring/v1/check_access',
    handler: async (req, reply) => {
      const response = {};
      try {
        await verifyMonitoringAuth(req);
        response.has_access = true; // response data is ignored
      } catch (err) {
        return reply(handleError(err, req));
      }
      return reply(response);
    }
  });
}

