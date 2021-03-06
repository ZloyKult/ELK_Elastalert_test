import { uiModules } from 'ui/modules';
import template from './threshold_watch_group_by.html';
import { ThresholdWatchBaseController } from '../threshold_watch_base';
import 'plugins/watcher/services/html_id_generator';
import 'plugins/watcher/components/xpack_aria_describes';

const app = uiModules.get('xpack/watcher');

app.directive('thresholdWatchGroupBy', function ($injector) {
  const htmlIdGeneratorFactory = $injector.get('xpackWatcherHtmlIdGeneratorFactory');

  return {
    restrict: 'E',
    template: template,
    scope: {
      itemId: '@',
      groupByTypes: '=',
      groupByType: '=',
      termSize: '=',
      termFields: '=',
      termField: '=',
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
    controllerAs: 'thresholdWatchGroupBy',
    controller: class ThresholdWatchGroupByController extends ThresholdWatchBaseController {
      initAfterBindings($scope) {
        this.makeId = htmlIdGeneratorFactory.create();

        $scope.$watchMulti([
          'thresholdWatchGroupBy.groupByType',
          'thresholdWatchGroupBy.termSize',
          'thresholdWatchGroupBy.termField'
        ], this.onChange);

        $scope.$watch('thresholdWatchGroupBy.groupByType', () => {
          this.resetForm();
          this.checkDirty();
        });

        $scope.$watch('thresholdWatchGroupBy.form.$valid', this.checkValidity);
        $scope.$watch('thresholdWatchGroupBy.form.$dirty', this.checkDirty);
      }

      get itemDescription() {
        return (this.groupByType && this.groupByType.sizeRequired) ? 'Grouped over' : 'Over';
      }

      get itemValue() {
        if (!this.groupByType) {
          return;
        }

        const sizeRequired = this.groupByType.sizeRequired;
        const typeLabel = this.groupByType.label;
        const sizeLabel = (sizeRequired && this.termSize) ? ` ${this.termSize}` : '';
        const fieldLabel = (sizeRequired && this.termField) ? ` '${this.termField.name}'` : '';

        return `${typeLabel}${sizeLabel}${fieldLabel}`;
      }
    }
  };
});
