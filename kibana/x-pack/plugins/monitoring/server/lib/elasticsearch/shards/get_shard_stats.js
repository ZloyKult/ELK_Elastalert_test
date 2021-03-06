import { get } from 'lodash';
import { checkParam } from '../../error_missing_required';
import { createQuery } from '../../create_query';
import { ElasticsearchMetric } from '../../metrics';
import { normalizeIndexShards, normalizeNodeShards } from './normalize_shard_objects';
import { getShardAggs } from './get_shard_stat_aggs';
import { calculateIndicesTotals } from './calculate_shard_stat_indices_totals';

export function handleResponse(resp, includeNodes, includeIndices, cluster) {
  let indices;
  let indicesTotals;
  let nodes;

  if (resp && resp.hits && resp.hits.total !== 0) {
    indices = resp.aggregations.indices.buckets.reduce(normalizeIndexShards, {});
    indicesTotals = calculateIndicesTotals(indices);

    if (includeNodes) {
      const masterNode = get(cluster, 'cluster_state.master_node');
      nodes = resp.aggregations.nodes.buckets.reduce(normalizeNodeShards(masterNode), {});
    }
  }

  return {
    indicesTotals,
    indices: includeIndices ? indices : undefined,
    nodes,
  };
}

export function getShardStats(req, esIndexPattern, cluster, { includeNodes = false, includeIndices = false } = {}) {
  checkParam(esIndexPattern, 'esIndexPattern in elasticsearch/getShardStats');

  const config = req.server.config();
  const nodeResolver = config.get('xpack.monitoring.node_resolver');
  const metric = ElasticsearchMetric.getMetricFields();
  const params = {
    index: esIndexPattern,
    ignore: [404],
    size: 0,
    body: {
      sort: { timestamp: { order: 'desc' } },
      query: createQuery({
        type: 'shards',
        clusterUuid: cluster.cluster_uuid,
        metric,
        filters: [ { term: { state_uuid: get(cluster, 'cluster_state.state_uuid') } } ]
      }),
      aggs: {
        ...getShardAggs(config, includeNodes, nodeResolver)
      }
    }
  };

  const { callWithRequest } = req.server.plugins.elasticsearch.getCluster('monitoring');
  return callWithRequest(req, 'search', params)
    .then(resp => {
      return handleResponse(resp, includeNodes, includeIndices, cluster);
    });
}
