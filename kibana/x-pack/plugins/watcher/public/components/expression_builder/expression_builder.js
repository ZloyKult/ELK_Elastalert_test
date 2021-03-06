import { uiModules } from 'ui/modules';
import template from './expression_builder.html';
import './components/expression_item';
import './components/expression_popover';

const app = uiModules.get('xpack/watcher');

app.directive('expressionBuilder', function () {
  return {
    restrict: 'E',
    replace: true,
    transclude: true,
    template: template,
    scope: {},
    bindToController: true,
    controllerAs: 'expressionBuilder',
    controller: class BuilderController {
      constructor() {
      }
    }
  };
});
