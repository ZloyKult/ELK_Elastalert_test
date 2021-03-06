import { get } from 'lodash';
import { checkParam } from '../../error_missing_required';
import { ElasticsearchMetric } from '../../metrics';
import { createQuery } from '../../create_query';
import { calculateRate } from '../../calculate_rate';

export function handleResponse(resp, min, max) {
  // map the hits
  const hits = get(resp, 'hits.hits', []);
  return hits.map(hit => {
    const stats = get(hit, '_source.index_stats');
    const earliestStats = get(hit, 'inner_hits.earliest.hits.hits[0]._source.index_stats');

    const rateOptions = {
      hitTimestamp: get(hit, '_source.timestamp'),
      earliestHitTimestamp: get(hit, 'inner_hits.earliest.hits.hits[0]._source.timestamp'),
      timeWindowMin: min,
      timeWindowMax: max
    };

    const earliestIndexingHit = get(earliestStats, 'primaries.indexing');
    const { rate: indexRate } = calculateRate({
      latestTotal: get(stats, 'primaries.indexing.index_total'),
      earliestTotal: get(earliestIndexingHit, 'index_total'),
      ...rateOptions
    });

    const earliestSearchHit = get(earliestStats, 'total.search');
    const { rate: searchRate } = calculateRate({
      latestTotal: get(stats, 'total.search.query_total'),
      earliestTotal: get(earliestSearchHit, 'query_total'),
      ...rateOptions
    });

    return {
      name: stats.index,
      doc_count: get(stats, 'primaries.docs.count'),
      data_size: get(stats, 'total.store.size_in_bytes'),
      index_rate: indexRate,
      search_rate: searchRate
    };
  });
}

export function getIndices(req, esIndexPattern, showSystemIndices = false) {
  checkParam(esIndexPattern, 'esIndexPattern in elasticsearch/getIndices');

  const { min, max } = req.payload.timeRange;

  const filters = [];
  if (!showSystemIndices) {
    filters.push({
      bool: {
        must_not: [
          { prefix: { 'index_stats.index': '.' } }
        ]
      }
    });
  }

  const clusterUuid = req.params.clusterUuid;
  const metricFields = ElasticsearchMetric.getMetricFields();
  const config = req.server.config();
  const params = {
    index: esIndexPattern,
    // TODO: make pagination happen here instead of browser-side
    // https://github.com/elastic/x-pack-kibana/issues/376
    size: config.get('xpack.monitoring.max_bucket_size'),
    ignoreUnavailable: true,
    filterPath: [ // only filter path can filter for inner_hits
      'hits.hits._source.index_stats.index',
      'hits.hits._source.index_stats.primaries.docs.count',
      'hits.hits._source.index_stats.total.store.size_in_bytes',

      // latest hits for calculating metrics
      'hits.hits._source.timestamp',
      'hits.hits._source.index_stats.primaries.indexing.index_total',
      'hits.hits._source.index_stats.total.search.query_total',

      // earliest hits for calculating metrics
      'hits.hits.inner_hits.earliest.hits.hits._source.timestamp',
      'hits.hits.inner_hits.earliest.hits.hits._source.index_stats.primaries.indexing.index_total',
      'hits.hits.inner_hits.earliest.hits.hits._source.index_stats.total.search.query_total',
    ],
    body: {
      query: createQuery({
        type: 'index_stats',
        start: min,
        end: max,
        clusterUuid,
        metric: metricFields,
        filters
      }),
      collapse: {
        field: 'index_stats.index',
        inner_hits: {
          name: 'earliest',
          size: 1,
          sort: [ { timestamp: 'asc' } ]
        }
      },
      sort: [ { timestamp: { order: 'desc' } } ]
    }
  };

  const { callWithRequest } = req.server.plugins.elasticsearch.getCluster('monitoring');
  return callWithRequest(req, 'search', params)
    .then(resp => handleResponse(resp, min, max));
}
