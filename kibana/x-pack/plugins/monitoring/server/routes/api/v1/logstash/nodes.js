import Joi from 'joi';
import Promise from 'bluebird';
import { getClusterStatus } from '../../../../lib/logstash/get_cluster_status';
import { getNodes } from '../../../../lib/logstash/get_nodes';
import { handleError } from '../../../../lib/errors';
import { prefixIndexPattern } from '../../../../lib/ccs_utils';

/*
 * Logstash Nodes route.
 */
export function logstashNodesRoute(server) {
  /**
   * Logtash Nodes request.
   *
   * This will fetch all data required to display the Logstash Nodes page.
   *
   * The current details returned are:
   *
   * - Logstash Cluster Status
   * - Nodes list
   */
  server.route({
    method: 'POST',
    path: '/api/monitoring/v1/clusters/{clusterUuid}/logstash/nodes',
    config: {
      validate: {
        params: Joi.object({
          clusterUuid: Joi.string().required()
        }),
        payload: Joi.object({
          ccs: Joi.string().optional(),
          timeRange: Joi.object({
            min: Joi.date().required(),
            max: Joi.date().required()
          }).required()
        })
      }
    },
    async handler(req, reply) {
      const config = server.config();
      const ccs = req.payload.ccs;
      const clusterUuid = req.params.clusterUuid;
      const lsIndexPattern = prefixIndexPattern(config, 'xpack.monitoring.logstash.index_pattern', ccs);

      try {
        const [ clusterStatus, nodes ] = await Promise.all([
          getClusterStatus(req, lsIndexPattern, { clusterUuid }),
          getNodes(req, lsIndexPattern, { clusterUuid }),
        ]);

        reply({
          clusterStatus,
          nodes,
        });
      }
      catch (err) {
        reply(handleError(err, req));
      }
    }
  });

}
