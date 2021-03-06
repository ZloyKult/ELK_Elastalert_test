/*
 * ELASTICSEARCH CONFIDENTIAL
 *
 * Copyright (c) 2017 Elasticsearch BV. All Rights Reserved.
 *
 * Notice: this software, and all information contained
 * therein, is the exclusive property of Elasticsearch BV
 * and its licensors, if any, and is protected under applicable
 * domestic and foreign law, and international treaties.
 *
 * Reproduction, republication or distribution without the
 * express written consent of Elasticsearch BV is
 * strictly prohibited.
 */

import _ from 'lodash';

import 'plugins/kibana/visualize/styles/main.less';
import { AggTypesIndexProvider } from 'ui/agg_types/index';
import { parseInterval } from 'ui/utils/parse_interval';

import dateMath from '@elastic/datemath';
import angular from 'angular';

import uiRoutes from 'ui/routes';
import { checkLicenseExpired } from 'plugins/ml/license/check_license';
import { checkCreateJobsPrivilege } from 'plugins/ml/privilege/check_privilege';
import { IntervalHelperProvider } from 'plugins/ml/util/ml_time_buckets';
import { filterAggTypes } from 'plugins/ml/jobs/new_job/simple/components/utils/filter_agg_types';
import { validateJobId } from 'plugins/ml/jobs/new_job/simple/components/utils/validate_job';
import { adjustIntervalDisplayed } from 'plugins/ml/jobs/new_job/simple/components/utils/adjust_interval';
import { createSearchItems, createResultsUrl } from 'plugins/ml/jobs/new_job/utils/new_job_utils';
import { populateAppStateSettings } from 'plugins/ml/jobs/new_job/simple/components/utils/app_state_settings';
import { CHART_STATE, JOB_STATE } from 'plugins/ml/jobs/new_job/simple/components/constants/states';
import { createFields } from 'plugins/ml/jobs/new_job/simple/components/utils/create_fields';
import { getIndexPattern, getSavedSearch, timeBasedIndexCheck } from 'plugins/ml/util/index_utils';
import { ChartDataUtilsProvider } from 'plugins/ml/jobs/new_job/simple/components/utils/chart_data_utils.js';
import { mlEscape } from 'plugins/ml/util/string_utils';
import template from './create_job.html';

uiRoutes
  .when('/jobs/new_job/simple/population', {
    template,
    resolve: {
      CheckLicense: checkLicenseExpired,
      privileges: checkCreateJobsPrivilege,
      indexPattern: getIndexPattern,
      savedSearch: getSavedSearch
    }
  });

import { uiModules } from 'ui/modules';
const module = uiModules.get('apps/ml');

module
  .controller('MlCreatePopulationJob', function (
    $scope,
    $route,
    $timeout,
    $q,
    timefilter,
    Private,
    mlJobService,
    mlPopulationJobService,
    mlMessageBarService,
    mlFullTimeRangeSelectorService,
    AppState) {

    timefilter.enableTimeRangeSelector();
    timefilter.disableAutoRefreshSelector();
    const msgs = mlMessageBarService;
    const MlTimeBuckets = Private(IntervalHelperProvider);
    const chartDataUtils = Private(ChartDataUtilsProvider);

    const stateDefaults = {
      mlJobSettings: {}
    };
    const appState = new AppState(stateDefaults);

    const aggTypes = Private(AggTypesIndexProvider);

    mlPopulationJobService.clearChartData();
    $scope.chartData = mlPopulationJobService.chartData;

    const PAGE_WIDTH = angular.element('.population-job-container').width();
    const BAR_TARGET = (PAGE_WIDTH > 1600) ? 800 : (PAGE_WIDTH / 2);
    const MAX_BARS = BAR_TARGET + (BAR_TARGET / 100) * 100; // 100% larger that bar target
    const REFRESH_INTERVAL_MS = 100;
    const MAX_BUCKET_DIFF = 3;
    const METRIC_AGG_TYPE = 'metrics';
    const DEFAULT_MODEL_MEMORY_LIMIT = '1024MB';

    let refreshCounter = 0;

    $scope.JOB_STATE = JOB_STATE;
    $scope.jobState = $scope.JOB_STATE.NOT_STARTED;

    $scope.CHART_STATE = CHART_STATE;
    $scope.chartStates = {
      eventRate: CHART_STATE.LOADING,
      fields: {}
    };

    // flag to stop all results polling if the user navigates away from this page
    let globalForceStop = false;

    const {
      indexPattern,
      savedSearch,
      query,
      filters,
      combinedQuery } = createSearchItems($route);

    timeBasedIndexCheck(indexPattern, true);

    const pageTitle = (savedSearch.id !== undefined) ?
      `saved search ${savedSearch.title}` : `index pattern ${indexPattern.title}`;

    $scope.ui = {
      indexPattern,
      pageTitle,
      showJobInput: true,
      showJobFinished: false,
      dirty: false,
      formValid: false,
      bucketSpanValid: true,
      bucketSpanEstimator: { status: 0, message: '' },
      aggTypeOptions: filterAggTypes(aggTypes.byType[METRIC_AGG_TYPE]),
      fields: [],
      overFields: [],
      splitFields: [],
      timeFields: [],
      splitText: '',
      wizard: {
        step: 0,
        forward: function () {
          wizardStep(1);
        },
        back: function () {
          wizardStep(-1);
        },
      },
      intervals: [{
        title: 'Auto',
        value: 'auto',
      }, {
        title: 'Millisecond',
        value: 'ms'
      }, {
        title: 'Second',
        value: 's'
      }, {
        title: 'Minute',
        value: 'm'
      }, {
        title: 'Hourly',
        value: 'h'
      }, {
        title: 'Daily',
        value: 'd'
      }, {
        title: 'Weekly',
        value: 'w'
      }, {
        title: 'Monthly',
        value: 'M'
      }, {
        title: 'Yearly',
        value: 'y'
      }, {
        title: 'Custom',
        value: 'custom'
      }],
      eventRateChartHeight: 100,
      chartHeight: 150,
      showFieldCharts: false,
      showAdvanced: false,
      validation: {
        checks: {
          jobId: { valid: true },
          groupIds: { valid: true }
        },
      },
      isOverField(field) {
        return (field.name === $scope.formConfig.overField.name) ? null : field;
      }
    };

    $scope.formConfig = {
      agg: {
        type: undefined
      },
      fields: [],
      bucketSpan: '15m',
      chartInterval: undefined,
      resultsIntervalSeconds: undefined,
      start: 0,
      end: 0,
      overField: undefined,
      timeField: indexPattern.timeFieldName,
      // splitField: undefined,
      influencerFields: [],
      firstSplitFieldName: undefined,
      indexPattern: indexPattern,
      query,
      filters,
      combinedQuery,
      jobId: undefined,
      description: undefined,
      jobGroups: [],
      useDedicatedIndex: false,
      modelMemoryLimit: DEFAULT_MODEL_MEMORY_LIMIT
    };

    $scope.formChange = function (refreshCardLayout) {
      $scope.ui.isFormValid();
      $scope.ui.dirty = true;

      $scope.loadVis();
      if (refreshCardLayout) {
        sortSplitCards();
      }
    };

    $scope.overChange = function () {
      $scope.addDefaultFieldsToInfluencerList();
      $scope.formChange();
    };

    $scope.splitChange = function (fieldIndex, splitField) {
      return $q((resolve) => {
        $scope.formConfig.fields[fieldIndex].firstSplitFieldName = undefined;

        if (splitField !== undefined) {
          $scope.formConfig.fields[fieldIndex].splitField =  splitField;

          $scope.addDefaultFieldsToInfluencerList();

          chartDataUtils.getSplitFields($scope.formConfig, splitField.name, 10)
            .then((resp) => {
              if (resp.results.values && resp.results.values.length) {
                $scope.formConfig.fields[fieldIndex].firstSplitFieldName = resp.results.values[0];
                $scope.formConfig.fields[fieldIndex].cardLabels = resp.results.values;
              }

              drawCards(fieldIndex, true);
              $scope.formChange();
              resolve();
            });
        } else {
          $scope.formConfig.fields[fieldIndex].splitField = undefined;
          $scope.formConfig.fields[fieldIndex].cardLabels = undefined;
          setFieldsChartStates(CHART_STATE.LOADING);
          $scope.toggleInfluencerChange();
          $scope.ui.splitText = '';
          destroyCards(fieldIndex);
          $scope.formChange();
          resolve();
        }
      });
    };

    $scope.splitReset = function (fieldIndex) {
      $scope.splitChange(fieldIndex, undefined);
    };

    function wizardStep(step) {
      $scope.ui.wizard.step += step;
    }

    function setTime() {
      $scope.ui.bucketSpanValid = true;
      $scope.formConfig.start = dateMath.parse(timefilter.time.from).valueOf();
      $scope.formConfig.end = dateMath.parse(timefilter.time.to).valueOf();
      $scope.formConfig.format = 'epoch_millis';

      if(parseInterval($scope.formConfig.bucketSpan) === null) {
        $scope.ui.bucketSpanValid = false;
      }

      const bounds = timefilter.getActiveBounds();
      $scope.formConfig.chartInterval = new MlTimeBuckets();
      $scope.formConfig.chartInterval.setBarTarget(BAR_TARGET);
      $scope.formConfig.chartInterval.setMaxBars(MAX_BARS);
      $scope.formConfig.chartInterval.setInterval('auto');
      $scope.formConfig.chartInterval.setBounds(bounds);

      adjustIntervalDisplayed($scope.formConfig);

      $scope.ui.isFormValid();
      $scope.ui.dirty = true;
    }

    function initAgg() {
      _.each($scope.ui.aggTypeOptions, (agg) => {
        if (agg.title === 'Mean') {
          $scope.formConfig.agg.type = agg;
        }
      });
    }

    $scope.ui.isFormValid = function () {
      if ($scope.formConfig.agg.type === undefined ||
        $scope.formConfig.timeField === undefined ||
        $scope.formConfig.fields.length === 0) {

        $scope.ui.formValid = false;
      } else {
        $scope.ui.formValid = true;
      }
      return $scope.ui.formValid;
    };

    $scope.loadVis = function () {
      const thisLoadTimestamp = Date.now();
      $scope.chartData.lastLoadTimestamp = thisLoadTimestamp;

      setTime();
      $scope.ui.isFormValid();

      $scope.ui.showJobInput = true;
      $scope.ui.showJobFinished = false;

      $scope.ui.dirty = false;

      mlPopulationJobService.clearChartData();

      // $scope.chartStates.eventRate = CHART_STATE.LOADING;
      setFieldsChartStates(CHART_STATE.LOADING);

      if ($scope.formConfig.fields.length) {
        $scope.ui.showFieldCharts = true;
        mlPopulationJobService.getLineChartResults($scope.formConfig, thisLoadTimestamp)
          .then((resp) => {
            loadDocCountData(resp.detectors);
          })
          .catch((resp) => {
            msgs.error(resp.message);
            $scope.formConfig.fields.forEach(field => {
              const id = field.id;
              $scope.chartStates.fields[id] = CHART_STATE.NO_RESULTS;
            });
          });
      } else {
        $scope.ui.showFieldCharts = false;
        loadDocCountData([]);
      }

      function loadDocCountData(dtrs) {
        chartDataUtils.loadDocCountData($scope.formConfig, $scope.chartData)
          .then((resp) => {
            if (thisLoadTimestamp === $scope.chartData.lastLoadTimestamp) {
              _.each(dtrs, (dtr, id) => {
                const state = (resp.totalResults) ? CHART_STATE.LOADED : CHART_STATE.NO_RESULTS;
                $scope.chartStates.fields[id] = state;
              });

              $scope.chartData.lastLoadTimestamp = null;
              chartDataUtils.updateChartMargin($scope.chartData);
              $scope.$broadcast('render');
              $scope.chartStates.eventRate = (resp.totalResults) ? CHART_STATE.LOADED : CHART_STATE.NO_RESULTS;
            }
          })
          .catch((resp) => {
            $scope.chartStates.eventRate = CHART_STATE.NO_RESULTS;
            msgs.error(resp.message);
          });
      }
    };

    function setFieldsChartStates(state) {
      _.each($scope.chartStates.fields, (chart, key) => {
        $scope.chartStates.fields[key] = state;
      });
    }

    function drawCards(fieldIndex, animate = true) {
      const labels = $scope.formConfig.fields[fieldIndex].cardLabels;
      const $frontCard = angular.element(`.population-job-container .detector-container.card-${fieldIndex} .card-front`);
      $frontCard.addClass('card');
      $frontCard.find('.card-title').text(labels[0]);
      const w = $frontCard.width();

      let marginTop = (labels.length > 1) ? 54 : 0;
      $frontCard.css('margin-top', marginTop);

      let backCardTitle = '';
      if (labels.length === 2) {
      // create a dummy label if there are only 2 cards, as the space will be visible
        backCardTitle = $scope.formConfig.fields[Object.keys($scope.formConfig.fields)[0]].agg.type.title;
        backCardTitle += ' ';
        backCardTitle += Object.keys($scope.formConfig.fields)[0];
      }

      angular.element(`.detector-container.card-${fieldIndex} .card-behind`).remove();

      for (let i = 0; i < labels.length; i++) {
        let el = '<div class="card card-behind"><div class="card-title">';
        el += mlEscape(labels[i]);
        el += '</div><label class="kuiFormLabel">';
        el += mlEscape(backCardTitle);
        el += '</label></div>';

        const $backCard = angular.element(el);
        $backCard.css('width', w);
        $backCard.css('height', 100);
        $backCard.css('display', 'auto');
        $backCard.css('z-index', (9 - i));

        $backCard.insertBefore($frontCard);
      }

      const cardsBehind = angular.element(`.detector-container.card-${fieldIndex} .card-behind`);
      let marginLeft = 0;
      let backWidth = w;

      for (let i = 0; i < cardsBehind.length; i++) {
        cardsBehind[i].style.marginTop = marginTop + 'px';
        cardsBehind[i].style.marginLeft = marginLeft + 'px';
        cardsBehind[i].style.width = backWidth + 'px';

        marginTop -= (10 - (i * (10 / labels.length))) * (10 / labels.length);
        marginLeft += (5 - (i / 2));
        backWidth -= (5 - (i / 2)) * 2;
      }
      let i = 0;
      let then = window.performance.now();
      const fps = 20;
      const fpsInterval = 1000 / fps;

      function fadeCard(callTime) {
        if (i < cardsBehind.length) {
          const now = callTime;
          const elapsed = now - then;
          if (elapsed > fpsInterval) {
            cardsBehind[i].style.opacity = 1;
            i++;
            then = now - (elapsed % fpsInterval);
          }
          window.requestAnimationFrame(fadeCard);
        }
      }
      if (animate) {
        fadeCard();
      } else {
        for (let j = 0; j < cardsBehind.length; j++) {
          cardsBehind[j].style.opacity = 1;
        }
      }
    }

    function destroyCards(fieldIndex) {
      angular.element(`.detector-container.card-${fieldIndex} .card-behind`).remove();

      const $frontCard = angular.element(`.population-job-container .detector-container.card-${fieldIndex} .card-front`);
      $frontCard.removeClass('card');
      $frontCard.find('.card-title').text('');
      $frontCard.css('margin-top', 0);
    }

    function sortSplitCards() {
    // cards may have moved, so redraw or remove the splits if needed
    // wrapped in a timeout to allow the digest to complete after the charts
    // has been placed on the page
      $timeout(() => {
        $scope.formConfig.fields.forEach((f, i) => {
          if (f.splitField === undefined) {
            destroyCards(i);
          } else {
            drawCards(i, false);
          }
        });
      }, 0);
    }

    let refreshInterval = REFRESH_INTERVAL_MS;
    // function for creating a new job.
    // creates the job, opens it, creates the datafeed and starts it.
    // the job may fail to open, but the datafeed should still be created
    // if the job save was successful.
    $scope.createJob = function () {
      if (validateJobId($scope.formConfig.jobId, $scope.formConfig.jobGroups, $scope.ui.validation.checks)) {
        msgs.clear();
        // create the new job
        mlPopulationJobService.createJob($scope.formConfig)
          .then((job) => {
            // if save was successful, open the job
            mlJobService.openJob(job.job_id)
              .then(() => {
                // if open was successful create a new datafeed
                saveNewDatafeed(job, true);
              })
              .catch((resp) => {
                msgs.error('Could not open job: ', resp);
                msgs.error('Job created, creating datafeed anyway');
                // if open failed, still attempt to create the datafeed
                // as it may have failed because we've hit the limit of open jobs
                saveNewDatafeed(job, false);
              });

          })
          .catch((resp) => {
            // save failed
            msgs.error('Save failed: ', resp.resp);
          });
      }

      // save new datafeed internal function
      // creates a new datafeed and attempts to start it depending
      // on startDatafeedAfterSave flag
      function saveNewDatafeed(job, startDatafeedAfterSave) {
        mlJobService.saveNewDatafeed(job.datafeed_config, job.job_id)
          .then(() => {

            if (startDatafeedAfterSave) {
              mlPopulationJobService.startDatafeed($scope.formConfig)
                .then(() => {
                  $scope.jobState = JOB_STATE.RUNNING;
                  refreshCounter = 0;
                  refreshInterval = REFRESH_INTERVAL_MS;

                  // create the interval size for querying results.
                  // it should not be smaller than the bucket_span
                  $scope.formConfig.resultsIntervalSeconds = $scope.formConfig.chartInterval.getInterval().asSeconds();
                  const bucketSpanSeconds = parseInterval($scope.formConfig.bucketSpan).asSeconds();
                  if ($scope.formConfig.resultsIntervalSeconds < bucketSpanSeconds) {
                    $scope.formConfig.resultsIntervalSeconds = bucketSpanSeconds;
                  }

                  $scope.resultsUrl = createResultsUrl(
                    $scope.formConfig.jobId,
                    $scope.formConfig.start,
                    $scope.formConfig.end,
                    'explorer');

                  loadCharts();
                })
                .catch((resp) => {
                  // datafeed failed
                  msgs.error('Could not start datafeed: ', resp);
                });
            }
          })
          .catch((resp) => {
            msgs.error('Save datafeed failed: ', resp);
          });
      }
    };

    function loadCharts() {
      let forceStop = globalForceStop;
      // the percentage doesn't always reach 100, so periodically check the datafeed status
      // to see if the datafeed has stopped
      const counterLimit = 20 - (refreshInterval / REFRESH_INTERVAL_MS);
      if (refreshCounter >=  counterLimit) {
        refreshCounter = 0;
        mlJobService.updateSingleJobDatafeedState($scope.formConfig.jobId)
          .then((state) => {
            if (state === 'stopped') {
              console.log('Stopping poll because datafeed state is: ' + state);
              $scope.$broadcast('render-results');
              forceStop = true;
            }
            run();
          });
      } else {
        run();
      }

      function run() {
        refreshCounter++;
        reloadJobSwimlaneData()
          .then(() => {
            reloadDetectorSwimlane()
              .then(() => {
                if (forceStop === false && $scope.chartData.percentComplete < 100) {
                  // if state has been set to stopping (from the stop button), leave state as it is
                  if ($scope.jobState === JOB_STATE.STOPPING) {
                    $scope.jobState = JOB_STATE.STOPPING;
                  } else {
                    // otherwise assume the job is running
                    $scope.jobState = JOB_STATE.RUNNING;
                  }
                } else {
                  $scope.jobState = JOB_STATE.FINISHED;
                }
                jobCheck();
              });
          });
      }
    }

    function jobCheck() {
      if ($scope.jobState === JOB_STATE.RUNNING || $scope.jobState === JOB_STATE.STOPPING) {
        refreshInterval = adjustRefreshInterval($scope.chartData.loadingDifference, refreshInterval);
        _.delay(loadCharts, refreshInterval);
      } else {
        _.each($scope.chartData.detectors, (chart) => {
          chart.percentComplete = 100;
        });
      }
      if ($scope.chartData.percentComplete > 0) {
      // fade the bar chart once we have results
        toggleSwimlaneVisibility();
      }
      $scope.$broadcast('render-results');
    }

    function reloadJobSwimlaneData() {
      return chartDataUtils.loadJobSwimlaneData($scope.formConfig, $scope.chartData);
    }


    function reloadDetectorSwimlane() {
      return chartDataUtils.loadDetectorSwimlaneData($scope.formConfig, $scope.chartData);
    }

    function adjustRefreshInterval(loadingDifference, currentInterval) {
      const INTERVAL_INCREASE_MS = 100;
      const MAX_INTERVAL = 10000;
      let interval = currentInterval;

      if (interval < MAX_INTERVAL) {
        if (loadingDifference < MAX_BUCKET_DIFF) {
          interval = interval + INTERVAL_INCREASE_MS;
        } else {
          if ((interval - INTERVAL_INCREASE_MS) >= REFRESH_INTERVAL_MS) {
            interval = interval - INTERVAL_INCREASE_MS;
          }
        }
      }
      return interval;
    }

    $scope.resetJob = function () {
      $scope.jobState = JOB_STATE.NOT_STARTED;
      toggleSwimlaneVisibility();

      window.setTimeout(() => {
        $scope.ui.showJobInput = true;
        $scope.loadVis();
      }, 500);
    };

    function toggleSwimlaneVisibility() {
      if ($scope.jobState === JOB_STATE.NOT_STARTED) {
        angular.element('.swimlane-cells').css('opacity', 0);
        angular.element('.bar').css('opacity', 1);
      } else {
        angular.element('.bar').css('opacity', 0.1);
      }
    }

    $scope.stopJob = function () {
    // setting the status to STOPPING disables the stop button
      $scope.jobState = JOB_STATE.STOPPING;
      mlPopulationJobService.stopDatafeed($scope.formConfig);
    };

    // resize the spilt cards on page resize.
    // when the job starts the 'Analysis running' label appearing can cause a scroll bar to appear
    // which will cause the split cards to look odd
    // TODO - all charts should resize correctly on page resize
    function resize() {
      if ($scope.formConfig.splitField !== undefined) {
        let width = angular.element('.card-front').width();
        const cardsBehind = angular.element('.card-behind');
        for (let i = 0; i < cardsBehind.length; i++) {
          cardsBehind[i].style.width = width + 'px';
          width -= (5 - (i / 2)) * 2;
        }
      }
    }

    $scope.setFullTimeRange = function () {
      mlFullTimeRangeSelectorService.setFullTimeRange($scope.ui.indexPattern, $scope.formConfig.combinedQuery);
    };

    initAgg();
    createFields($scope, indexPattern);

    $scope.loadVis();

    $scope.$evalAsync(() => {
    // populate the fields with any settings from the URL
      populateAppStateSettings(appState, $scope);
    });

    $scope.$listen(timefilter, 'fetch', $scope.loadVis);

    angular.element(window).resize(() => {
      resize();
    });

    $scope.$on('$destroy', () => {
      globalForceStop = true;
      angular.element(window).off('resize');
    });
  });
