import { get } from 'lodash';
import Joi from 'joi';
import { getClusterStats } from '../../../../lib/cluster/get_cluster_stats';
import { getIndexSummary } from '../../../../lib/elasticsearch/indices';
import { getMetrics } from '../../../../lib/details/get_metrics';
import { getShardAllocation, getShardStats } from '../../../../lib/elasticsearch/shards';
import { handleError } from '../../../../lib/errors/handle_error';
import { prefixIndexPattern } from '../../../../lib/ccs_utils';

export function indexRoutes(server) {

  server.route({
    method: 'POST',
    path: '/api/monitoring/v1/clusters/{clusterUuid}/elasticsearch/indices/{id}',
    config: {
      validate: {
        params: Joi.object({
          clusterUuid: Joi.string().required(),
          id: Joi.string().required()
        }),
        payload: Joi.object({
          ccs: Joi.string().optional(),
          timeRange: Joi.object({
            min: Joi.date().required(),
            max: Joi.date().required()
          }).required(),
          metrics: Joi.array().required(),
          shards: Joi.boolean().default(true) // false for Advanced view
        })
      }
    },
    handler: async (req, reply) => {
      try {
        const config = server.config();
        const ccs = req.payload.ccs;
        const clusterUuid = req.params.clusterUuid;
        const indexUuid = req.params.id;
        const start = req.payload.timeRange.min;
        const end = req.payload.timeRange.max;
        const esIndexPattern = prefixIndexPattern(config, 'xpack.monitoring.elasticsearch.index_pattern', ccs);
        const collectShards = req.payload.shards; // for advanced view

        const cluster = await getClusterStats(req, esIndexPattern, clusterUuid);
        const showSystemIndices = true; // hardcode to true, because this could be a system index

        const shardStats = await getShardStats(req, esIndexPattern, cluster, { includeNodes: true, includeIndices: true });
        const indexSummary = await getIndexSummary(req, esIndexPattern, shardStats, { clusterUuid, indexUuid, start, end });
        const metrics = await getMetrics(req, esIndexPattern, [{ term: { 'index_stats.index': indexUuid } }]);

        let shardAllocation;
        if (collectShards) {
          // TODO: Why so many fields needed for a single component (shard legend)?
          const shardFilter = { term: { 'shard.index': indexUuid } };
          const stateUuid = get(cluster, 'cluster_state.state_uuid');
          const allocationOptions = {
            nodeResolver: config.get('xpack.monitoring.node_resolver'),
            shardFilter,
            stateUuid,
            showSystemIndices,
          };
          const shards = await getShardAllocation(req, esIndexPattern, allocationOptions);

          shardAllocation = {
            shards,
            shardStats: { nodes: shardStats.nodes },
            nodes: shardStats.nodes, // for identifying nodes that shard relocates to
            stateUuid, // for debugging/troubleshooting
          };
        }

        reply({
          indexSummary,
          metrics,
          ...shardAllocation,
        });

      } catch (err) {
        reply(handleError(err, req));
      }
    }
  });

}
