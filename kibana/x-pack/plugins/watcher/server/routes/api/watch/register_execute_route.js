import { get } from 'lodash';
import { callWithRequestFactory } from '../../../lib/call_with_request_factory';
import { ExecuteDetails } from '../../../models/execute_details';
import { Watch } from '../../../models/watch';
import { WatchHistoryItem } from '../../../models/watch_history_item';
import { isEsErrorFactory } from '../../../lib/is_es_error_factory';
import { wrapEsError, wrapUnknownError } from '../../../lib/error_wrappers';
import { licensePreRoutingFactory } from'../../../lib/license_pre_routing_factory';

function executeWatch(callWithRequest, executeDetails, watchJson) {
  const body = executeDetails;
  body.watch = watchJson;

  return callWithRequest('watcher.executeWatch', {
    body
  });
}

export function registerExecuteRoute(server) {
  const isEsError = isEsErrorFactory(server);
  const licensePreRouting = licensePreRoutingFactory(server);

  server.route({
    path: '/api/watcher/watch/execute',
    method: 'PUT',
    handler: (request, reply) => {
      const callWithRequest = callWithRequestFactory(server, request);
      const executeDetails = ExecuteDetails.fromDownstreamJson(request.payload.executeDetails);
      const watch = Watch.fromDownstreamJson(request.payload.watch);

      return executeWatch(callWithRequest, executeDetails.upstreamJson, watch.watchJson)
        .then((hit) => {
          const id = get(hit, '_id');
          const watchHistoryItemJson = get(hit, 'watch_record');
          const watchId = get(hit, 'watch_record.watch_id');
          const json = {
            id,
            watchId,
            watchHistoryItemJson,
            includeDetails: true
          };

          const watchHistoryItem = WatchHistoryItem.fromUpstreamJson(json);
          reply({ watchHistoryItem: watchHistoryItem.downstreamJson });
        })
        .catch(err => {

        // Case: Error from Elasticsearch JS client
          if (isEsError(err)) {
            return reply(wrapEsError(err));
          }

          // Case: default
          reply(wrapUnknownError(err));
        });
    },
    config: {
      pre: [ licensePreRouting ]
    }
  });
}
