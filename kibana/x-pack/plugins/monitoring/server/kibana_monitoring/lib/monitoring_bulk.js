export function monitoringBulk(Client, _config, components) {
  const ca = components.clientAction.factory;
  Client.prototype.monitoring = components.clientAction.namespaceFactory();
  const monitoring = Client.prototype.monitoring.prototype;

  /**
  * Perform a [monitoring.bulk](http://www.elastic.co/guide/en/elasticsearch/reference/master/docs-bulk.html) request
  *
  * @param {Object} params - An object with parameters used to carry out this action
  * @param {String} params.system_id - Reporting application id
  * @param {String} params.system_api_version - Reporting application API version
  * @param {Number} params.interval - Collection interval in string format (e.g., '10s' or '10000ms')
  * @param {String} params.consistency - Explicit write consistency setting for the operation
  * @param {Boolean} params.refresh - Refresh the index after performing the operation
  * @param {String} params.routing - Specific routing value
  * @param {Date, Number} params.timeout - Explicit operation timeout
  * @param {String} params.type - Default document type for items which don't provide one
  * @param {String, String[], Boolean} params.fields - Default comma-separated list of fields to return in the response for updates
  */
  monitoring.bulk = ca({
    params: {
      system_id: {
        type: 'string'
      },
      system_api_version: {
        type: 'string'
      },
      type: {
        type: 'string'
      },
      interval: {
        type: 'string'
      }
    },
    urls: [{
      fmt: '/_xpack/monitoring/<%=type%>/_bulk',
      req: {
        type: {
          type: 'string'
        }
      }
    }, {
      fmt: '/_xpack/monitoring/_bulk'
    }],
    needBody: true,
    bulkBody: true,
    method: 'POST'
  });

}
