import { get } from 'lodash';
import { createQuery } from '../create_query';
import { ElasticsearchMetric } from '../metrics';

/**
 * Get a list of Cluster UUIDs that exist within the specified timespan.
 *
 * @param {Object} server The server instance
 * @param {function} callCluster The callWithRequest or callWithInternalUser handler
 * @param {Date} start The start date to look for clusters
 * @param {Date} end The end date to look for clusters
 * @return {Array} Array of strings; one per Cluster UUID.
 */
export function getClusterUuids(server, callCluster, start, end) {
  return fetchClusterUuids(server, callCluster, start, end)
    .then(handleClusterUuidsResponse);
}

/**
 * Fetch the aggregated Cluster UUIDs from the monitoring cluster.
 *
 * @param {Object} server The server instance
 * @param {function} callCluster The callWithRequest or callWithInternalUser handler
 * @param {Date} start The start date to look for clusters
 * @param {Date} end The end date to look for clusters
 * @return {Promise} Object response from the aggregation.
 */
export function fetchClusterUuids(server, callCluster, start, end) {
  const config = server.config();
  const params = {
    index: config.get('xpack.monitoring.elasticsearch.index_pattern'),
    ignoreUnavailable: true,
    filterPath: 'aggregations.cluster_uuids.buckets.key',
    body: {
      size: 0, // return no hits, just aggregation buckets
      query: createQuery({ type: 'cluster_stats', start, end, metric: ElasticsearchMetric.getMetricFields() }),
      aggs: {
        cluster_uuids: {
          terms: {
            field: 'cluster_uuid',
            size: config.get('xpack.monitoring.max_bucket_size')
          }
        }
      }
    }
  };

  return callCluster('search', params);
}

/**
 * Convert the aggregation response into an array of Cluster UUIDs.
 *
 * @param {Object} response The aggregation response
 * @return {Array} Strings; each representing a Cluster's UUID.
 */
export function handleClusterUuidsResponse(response) {
  const uuidBuckets = get(response, 'aggregations.cluster_uuids.buckets', []);

  return uuidBuckets.map(uuidBucket => uuidBucket.key);
}
