import { ajaxErrorHandlersProvider } from 'plugins/monitoring/lib/ajax_error_handler';

export function getPageData($injector) {
  const $http = $injector.get('$http');
  const globalState = $injector.get('globalState');
  const url = `../api/monitoring/v1/clusters/${globalState.cluster_uuid}/elasticsearch/ml_jobs`;
  const timefilter = $injector.get('timefilter');
  const timeBounds = timefilter.getBounds();
  return $http.post(url, {
    ccs: globalState.ccs,
    timeRange: {
      min: timeBounds.min.toISOString(),
      max: timeBounds.max.toISOString()
    }
  })
    .then(response => response.data)
    .catch((err) => {
      const Private = $injector.get('Private');
      const ajaxErrorHandlers = Private(ajaxErrorHandlersProvider);
      return ajaxErrorHandlers(err);
    });
}

