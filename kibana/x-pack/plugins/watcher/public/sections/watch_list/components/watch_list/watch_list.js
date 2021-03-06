import pluralize from 'pluralize';
import { uiModules } from 'ui/modules';
import { InitAfterBindingsWorkaround } from 'ui/compat';
import { Notifier } from 'ui/notify/notifier';
import template from './watch_list.html';
import '../watch_table';
import { PAGINATION, REFRESH_INTERVALS } from 'plugins/watcher/../common/constants';
import 'ui/pager_control';
import 'ui/pager';
import 'ui/react_components';
import 'ui/table_info';
import 'plugins/watcher/components/tool_bar_selected_count';
import 'plugins/watcher/components/forbidden_message';
import 'plugins/watcher/components/watch_type_select';
import 'plugins/watcher/services/watches';
import 'plugins/watcher/services/license';

const app = uiModules.get('xpack/watcher');

app.directive('watchList', function ($injector) {
  const pagerFactory = $injector.get('pagerFactory');
  const watchesService = $injector.get('xpackWatcherWatchesService');
  const licenseService = $injector.get('xpackWatcherLicenseService');
  const confirmModal = $injector.get('confirmModal');
  const $interval = $injector.get('$interval');
  const kbnUrl = $injector.get('kbnUrl');

  const $filter = $injector.get('$filter');
  const filter = $filter('filter');
  const orderBy = $filter('orderBy');
  const limitTo = $filter('limitTo');

  return {
    restrict: 'E',
    template: template,
    scope: {
      watches: '='
    },
    bindToController: true,
    controllerAs: 'watchList',
    controller: class WatchListController extends InitAfterBindingsWorkaround {
      initAfterBindings($scope) {
        this.forbidden = false;

        //The initial load from watch_list_route will return null on a 403 error
        if (this.watches === null) {
          this.watches = [];
          this.forbidden = true;
        }

        this.selectedWatches = [];
        this.pageOfWatches = [];
        this.sortField = 'id';
        this.sortReverse = false;

        this.notifier = new Notifier({ location: 'Watcher' });
        this.pager = pagerFactory.create(this.watches.length, PAGINATION.PAGE_SIZE, 1);

        // Reload watches periodically
        const refreshInterval = $interval(() => this.loadWatches(), REFRESH_INTERVALS.WATCH_LIST);
        $scope.$on('$destroy', () => $interval.cancel(refreshInterval));

        // react to watch and ui changes
        $scope.$watchMulti([
          'watchList.watches',
          'watchList.sortField',
          'watchList.sortReverse',
          'watchList.query',
          'watchList.pager.currentPage'
        ], this.applyFilters);
      }

      get hasPageOfWatches() {
        return this.pageOfWatches.length > 0;
      }

      get hasSelectedWatches() {
        return this.selectedWatches.length > 0;
      }

      loadWatches = () => {
        watchesService.getWatchList()
          .then(watches => {
            this.watches = watches;
            this.forbidden = false;
          })
          .catch(err => {
            return licenseService.checkValidity()
              .then(() => {
                if (err.status === 403) {
                  this.forbidden = true;
                } else {
                  this.notifier.error(err);
                }
              });
          });
      }

      onQueryChange = (query) => {
        this.query = query;
      };

      onPageNext = () => {
        this.pager.nextPage();
      };

      onPagePrevious = () => {
        this.pager.previousPage();
      };

      onSortChange = (field, reverse) => {
        this.sortField = field;
        this.sortReverse = reverse;
      };

      onSelectedChange = (selectedWatches) => {
        this.selectedWatches = selectedWatches;
      };

      onWatchTypeChange = (watchType) => {
        const url = `management/elasticsearch/watcher/watches/new-watch/${watchType}`;
        kbnUrl.change(url, {});
      }

      onSelectedWatchesDelete = () => {
        const watchesBeingDeleted = this.selectedWatches;
        const numWatchesToDelete = watchesBeingDeleted.length;
        const watchesStr = pluralize('Watch', numWatchesToDelete);

        const confirmModalText = `This will permanently delete ${numWatchesToDelete} ${watchesStr}. Are you sure?`;
        const confirmButtonText = `Delete ${numWatchesToDelete} ${watchesStr}`;

        const confirmModalOptions = {
          confirmButtonText,
          onConfirm: () => this.deleteSelectedWatches(watchesBeingDeleted)
        };

        return confirmModal(confirmModalText, confirmModalOptions);
      };

      deleteSelectedWatches = (watchesBeingDeleted) => {
        this.watchesBeingDeleted = watchesBeingDeleted;

        const numWatchesToDelete = this.watchesBeingDeleted.length;
        const watchesStr = pluralize('Watch', numWatchesToDelete);

        const watchIds = this.watchesBeingDeleted.map(watch => watch.id);
        return watchesService.deleteWatches(watchIds)
          .then(results => {
            const numSuccesses = results.numSuccesses;
            const numErrors = results.numErrors;
            const numTotal = numWatchesToDelete;

            if (numSuccesses > 0) {
              this.notifier.info(`Deleted ${numSuccesses} out of ${numTotal} selected ${watchesStr}`);
            }

            if (numErrors > 0) {
              this.notifier.error(`Could not delete ${numErrors} out of ${numTotal} selected ${watchesStr}`);
            }

            this.loadWatches();
          })
          .catch(err => {
            return licenseService.checkValidity()
              .then(() => this.notifier.error(err));
          });
      }

      applyFilters = () => {
        let filteredWatches = this.watches;
        let pageOfWatches = [];

        filteredWatches = filter(filteredWatches, { searchValue: this.query });
        filteredWatches = orderBy(filteredWatches, this.sortField, this.sortReverse);
        pageOfWatches = limitTo(filteredWatches, this.pager.pageSize, this.pager.startIndex);

        this.pageOfWatches = pageOfWatches;
        this.pager.setTotalItems(filteredWatches.length);
      };
    }
  };
});
