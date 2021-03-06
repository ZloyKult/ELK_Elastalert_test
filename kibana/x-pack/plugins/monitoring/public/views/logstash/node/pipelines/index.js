/*
 * Logstash Node Pipelines Listing
 */

import { find } from 'lodash';
import uiRoutes from 'ui/routes';
import { ajaxErrorHandlersProvider } from 'plugins/monitoring/lib/ajax_error_handler';
import { routeInitProvider } from 'plugins/monitoring/lib/route_init';
import {
  isPipelineMonitoringSupportedInVersion,
  processPipelinesAPIResponse
} from 'plugins/monitoring/lib/logstash/pipelines';
import template from './index.html';

const getPageData = ($injector) => {
  const $route = $injector.get('$route');
  const $http = $injector.get('$http');
  const globalState = $injector.get('globalState');
  const timefilter = $injector.get('timefilter');
  const Private = $injector.get('Private');

  const logstashUuid = $route.current.params.uuid;
  const url = `../api/monitoring/v1/clusters/${globalState.cluster_uuid}/logstash/node/${logstashUuid}/pipelines`;
  const timeBounds = timefilter.getBounds();

  const throughputMetric = 'logstash_node_pipeline_throughput';
  const nodesCountMetric = 'logstash_node_pipeline_nodes_count';

  return $http.post(url, {
    ccs: globalState.ccs,
    timeRange: {
      min: timeBounds.min.toISOString(),
      max: timeBounds.max.toISOString()
    },
    metrics: [
      throughputMetric,
      nodesCountMetric,
    ]
  })
    .then(response => processPipelinesAPIResponse(response.data, throughputMetric, nodesCountMetric))
    .catch((err) => {
      const ajaxErrorHandlers = Private(ajaxErrorHandlersProvider);
      return ajaxErrorHandlers(err);
    });
};

function makeUpgradeMessage(logstashVersion) {
  if (isPipelineMonitoringSupportedInVersion(logstashVersion)) {
    return null;
  }

  return `Pipeline monitoring is only available in Logstash version 6.0.0 or higher. This node is running version ${logstashVersion}.`;
}

uiRoutes
  .when('/logstash/node/:uuid/pipelines', {
    template,
    resolve: {
      clusters(Private) {
        const routeInit = Private(routeInitProvider);
        return routeInit();
      },
      pageData: getPageData
    },
    controller($injector, $scope) {
      const $route = $injector.get('$route');
      const globalState = $injector.get('globalState');
      const timefilter = $injector.get('timefilter');
      const title = $injector.get('title');
      const $executor = $injector.get('$executor');

      $scope.cluster = find($route.current.locals.clusters, { cluster_uuid: globalState.cluster_uuid });
      $scope.pageData = $route.current.locals.pageData;

      $scope.upgradeMessage = makeUpgradeMessage($scope.pageData.nodeSummary.version);
      timefilter.enableTimeRangeSelector();
      timefilter.enableAutoRefreshSelector();

      title($scope.cluster, `Logstash - ${$scope.pageData.nodeSummary.name} - Pipelines`);

      $executor.register({
        execute: () => getPageData($injector),
        handleResponse: (response) => $scope.pageData = response
      });

      $executor.start();

      $scope.$on('$destroy', $executor.destroy);
    }
  });
