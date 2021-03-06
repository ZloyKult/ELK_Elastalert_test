import { find } from 'lodash';
import uiRoutes from'ui/routes';
import { routeInitProvider } from 'plugins/monitoring/lib/route_init';
import { MonitoringViewBaseTableController } from '../../';
import { getPageData } from './get_page_data';
import template from './index.html';

uiRoutes.when('/beats/beats', {
  template,
  resolve: {
    clusters: function (Private) {
      const routeInit = Private(routeInitProvider);
      return routeInit();
    },
    pageData: getPageData,
  },
  controllerAs: 'beats',
  controller: class BeatsListing extends MonitoringViewBaseTableController {
    constructor($injector, $scope) {
      // breadcrumbs + page title
      const $route = $injector.get('$route');
      const globalState = $injector.get('globalState');
      $scope.cluster = find($route.current.locals.clusters, { cluster_uuid: globalState.cluster_uuid });

      super({
        title: 'Beats',
        storageKey: 'beats.beats',
        getPageData,
        $scope,
        $injector
      });

      this.data = $route.current.locals.pageData;
    }
  }
});
