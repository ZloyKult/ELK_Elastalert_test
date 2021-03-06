import { get } from 'lodash';
import moment from 'moment';
import { checkParam } from '../error_missing_required';
import { createQuery } from '../create_query';
import { calculateAvailability } from '../calculate_availability';
import { ElasticsearchMetric } from '../metrics';

/*
 * Get detailed info for Kibanas in the cluster
 * for Kibana listing page
 * For each instance:
 *  - name
 *  - status
 *  - memory
 *  - os load average
 *  - requests
 *  - response times
 */
export function getKibanas(req, kbnIndexPattern, { clusterUuid }) {
  checkParam(kbnIndexPattern, 'kbnIndexPattern in getKibanas');

  const config = req.server.config();
  const start = moment.utc(req.payload.timeRange.min).valueOf();
  const end = moment.utc(req.payload.timeRange.max).valueOf();

  const params = {
    index: kbnIndexPattern,
    body: {
      size: config.get('xpack.monitoring.max_bucket_size'),
      query: createQuery({
        type: 'kibana_stats',
        start,
        end,
        clusterUuid,
        metric: ElasticsearchMetric.getMetricFields()
      }),
      collapse: {
        field: 'kibana_stats.kibana.uuid'
      },
      sort: [
        { timestamp: { order: 'desc' } }
      ],
      _source: [
        'timestamp',
        'kibana_stats.process.memory.resident_set_size_in_bytes',
        'kibana_stats.os.load.1m',
        'kibana_stats.response_times.average',
        'kibana_stats.response_times.max',
        'kibana_stats.requests.total',
        'kibana_stats.kibana.transport_address',
        'kibana_stats.kibana.name',
        'kibana_stats.kibana.host',
        'kibana_stats.kibana.uuid',
        'kibana_stats.kibana.status',
        'kibana_stats.concurrent_connections'
      ]
    }
  };

  const { callWithRequest } = req.server.plugins.elasticsearch.getCluster('monitoring');
  return callWithRequest(req, 'search', params)
    .then(resp => {
      const instances = get(resp, 'hits.hits', []);

      return instances.map(hit => {
        return {
          ...get(hit, '_source.kibana_stats'),
          availability: calculateAvailability(get(hit, '_source.timestamp'))
        };
      });
    });
}
