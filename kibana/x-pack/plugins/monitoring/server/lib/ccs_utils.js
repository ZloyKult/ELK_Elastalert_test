/**
 * Prefix all comma separated index patterns within the original {@code indexPattern}.
 *
 * Cross Cluster Search (CCS) prefixing is ignored if the user has disabled CCS via kibana.yml,
 * which means that the index pattern will be returned without using {@code ccs}.
 *
 * @param  {Object} config The Kibana configuration object.
 * @param  {String} indexPatternName The index pattern name (e.g., 'xpack.monitoring.elasticsearch.index_pattern')
 * @param  {String} ccs The optional cluster-prefix to prepend.
 * @return {String} The index pattern with the {@code cluster} prefix appropriately prepended.
 */
export function prefixIndexPattern(config, indexPatternName, ccs) {
  const ccsEnabled = config.get('xpack.monitoring.ccs.enabled');
  const indexPattern = config.get(indexPatternName);

  if (!ccsEnabled || !ccs) {
    return indexPattern;
  }

  const patterns = indexPattern.split(',');
  const prefixedPattern = patterns.map(pattern => `${ccs}:${pattern}`).join(',');

  // if a wildcard is used, then we also want to search the local indices
  if (ccs === '*') {
    return `${prefixedPattern},${indexPattern}`;
  }

  return prefixedPattern;
}

/**
 * Parse the cross-cluster prefix from an index name returned as part of a hit from Elasticsearch.
 *
 * For example, the first hit should return 'my_cluster', while the second hit should return null:
 *
 * {
 *   hits: {
 *     total: 2,
 *     hits: [
 *       {
 *         _index: my_cluster:.monitoring-es-6-2017.07.28,
 *         _type: doc,
 *         _id: xyz456,
 *         _source: { ... }
 *       },
 *       {
 *         _index: .monitoring-es-6-2017.07.28,
 *         _type: doc,
 *         _id: abc123,
 *         _source: { ... }
 *       }
 *     ]
 *   }
 * }
 *
 * @param  {String} indexName The index's name, possibly including the cross-cluster prefix
 * @return {String} {@code null} if none. Otherwise the cluster prefix.
 */
export function parseCrossClusterPrefix(indexName) {
  const colonIndex = indexName.indexOf(':');

  if (colonIndex === -1) {
    return null;
  }

  // if we found a : in the index name, then cross-cluster search (CCS) was used to find the cluster
  // and we _should_ use it when we search explicitly for this cluster (to avoid inefficiently checking other monitoring _clusters_)
  return indexName.substr(0, colonIndex);
}
