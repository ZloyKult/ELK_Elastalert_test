import { uiModules } from 'ui/modules';
import template from './threshold_watch_time_window.html';
import { TIME_UNITS } from 'plugins/watcher/../common/constants';
import { getTimeUnitsLabel } from 'plugins/watcher/lib/get_time_units_label';
import { ThresholdWatchBaseController } from '../threshold_watch_base';
import 'plugins/watcher/components/duration_select';
import 'plugins/watcher/services/html_id_generator';
import 'plugins/watcher/components/xpack_aria_describes';

const app = uiModules.get('xpack/watcher');

app.directive('thresholdWatchTimeWindow', function ($injector) {
  const htmlIdGeneratorFactory = $injector.get('xpackWatcherHtmlIdGeneratorFactory');

  return {
    restrict: 'E',
    template: template,
    scope: {
      itemId: '@',
      timeWindowUnits: '=',
      timeWindowSize: '=',
      timeWindowUnit: '=',
      isOpen: '=',
      isVisible: '=',
      onOpen: '=',
      onClose: '=',
      onChange: '=',
      onValid: '=',
      onInvalid: '=',
      onDirty: '=',
      onPristine: '='
    },
    bindToController: true,
    controllerAs: 'thresholdWatchTimeWindow',
    controller: class ThresholdWatchTimeWindowController extends ThresholdWatchBaseController {
      initAfterBindings($scope) {
        this.makeId = htmlIdGeneratorFactory.create();

        this.timeWindowMinimumUnit = TIME_UNITS.SECOND;
        this.timeWindowMinimumSize = 10;

        $scope.$watchMulti([
          'thresholdWatchTimeWindow.timeWindowSize',
          'thresholdWatchTimeWindow.timeWindowUnit'
        ], this.onChange);

        $scope.$watch('thresholdWatchTimeWindow.form.$valid', this.checkValidity);
        $scope.$watch('thresholdWatchTimeWindow.form.$dirty', this.checkDirty);
      }

      get itemDescription() {
        return 'For the last';
      }

      get itemValue() {
        const sizeLabel = !isNaN(this.timeWindowSize)
          ? `${this.timeWindowSize} `
          : '0';

        const unitLabel = Boolean(this.timeWindowUnit)
          ? getTimeUnitsLabel(this.timeWindowUnit, this.timeWindowSize)
          : '';

        return `${sizeLabel} ${unitLabel}`;
      }
    }
  };
});
