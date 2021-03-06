import _ from 'lodash';
import { uiModules } from 'ui/modules';

const uiModule = uiModules.get('monitoring/features', []);
uiModule.service('features', function ($window) {
  function getData() {
    let returnData = {};
    const monitoringData = $window.localStorage.getItem('xpack.monitoring.data');

    try {
      returnData = (monitoringData && JSON.parse(monitoringData)) || {};
    } catch (e) {
      console.error('Monitoring UI: error parsing locally stored monitoring data', e);
    }

    return returnData;
  }

  function update(featureName, value) {
    const monitoringDataObj = getData();
    monitoringDataObj[featureName] = value;
    $window.localStorage.setItem('xpack.monitoring.data', JSON.stringify(monitoringDataObj));
  }

  function isEnabled(featureName, defaultSetting) {
    const monitoringDataObj = getData();
    if (_.has(monitoringDataObj, featureName)) {
      return monitoringDataObj[featureName];
    }

    if (_.isUndefined(defaultSetting)) {
      return false;
    }

    return defaultSetting;
  }

  return {
    isEnabled,
    update
  };
});
