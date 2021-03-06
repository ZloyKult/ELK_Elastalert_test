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
import angular from 'angular';
import dateMath from '@elastic/datemath';
import { isJobIdValid, prefixDatafeedId } from 'plugins/ml/../common/util/job_utils';
import { createSearchItems, createResultsUrl } from 'plugins/ml/jobs/new_job/utils/new_job_utils';

import 'plugins/kibana/visualize/styles/main.less';

import uiRoutes from 'ui/routes';
import { checkLicenseExpired } from 'plugins/ml/license/check_license';
import { checkCreateJobsPrivilege } from 'plugins/ml/privilege/check_privilege';
import { getIndexPattern, getSavedSearch } from 'plugins/ml/util/index_utils';
import template from './create_job.html';

uiRoutes
  .when('/jobs/new_job/simple/recognize', {
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
  .controller('MlCreateRecognizerJobs', function (
    $scope,
    $window,
    $route,
    $q,
    ml,
    timefilter,
    Private,
    mlCreateRecognizerJobsService,
    mlJobService,
    mlMessageBarService) {

    timefilter.disableTimeRangeSelector();
    timefilter.disableAutoRefreshSelector();
    $scope.tt = timefilter;
    const msgs = mlMessageBarService;

    const SAVE_STATE = {
      NOT_SAVED: 0,
      SAVING: 1,
      SAVED: 2,
      FAILED: 3
    };

    const DATAFEED_STATE = {
      NOT_STARTED: 0,
      STARTING: 1,
      STARTED: 2,
      FINISHED: 3,
      STOPPING: 4,
      FAILED: 5
    };


    $scope.SAVE_STATE = SAVE_STATE;
    $scope.DATAFEED_STATE = DATAFEED_STATE;

    $scope.overallState = SAVE_STATE.NOT_SAVED;

    const { indexPattern, query } = createSearchItems($route);

    const pageTitle = `index pattern ${indexPattern.title}`;

    $scope.ui = {
      formValid: true,
      indexPattern,
      pageTitle,
      showJobInput: true,
      numberOfJobs: 0,
      kibanaLabels: {
        dashboard: 'Dashboards',
        search: 'Searches',
        visualization: 'Visualizations',
      },
      validation: {
        checks: {
          jobLabel: { valid: true },
          groupIds: { valid: true }
        },
      },
    };

    $scope.formConfig = {
      indexPattern,
      jobLabel: '',
      jobGroups: [],
      jobs: [],
      kibanaObjects: {
        dashboard: [],
        search: [],
        visualization: []
      },
      start: 0,
      end: 0,
      query,
      filters: [],
      useFullIndexData: true,
      startDatafeedAfterSave: true
    };

    $scope.resultsUrl = '';

    const moduleId = $route.current.params.id;

    $scope.resetJob = function () {
      $scope.overallState = SAVE_STATE.NOT_SAVED;
      $scope.formConfig.jobs = [];
      $scope.formConfig.filters = [];
      $scope.formConfig.kibanaObjects.dashboard = [];
      $scope.formConfig.kibanaObjects.search = [];
      $scope.formConfig.kibanaObjects.visualization = [];

      loadJobConfigs();
    };

    function loadJobConfigs() {
    // load the job and datafeed configs as well as the kibana saved objects
    // from the recognizer endpoint
      ml.getDataRecognizerModule({ moduleId })
        .then(resp => {
          // populate the jobs and datafeeds
          if (resp.jobs && resp.jobs.length) {

            const tempGroups = {};

            resp.jobs.forEach((job) => {
              $scope.formConfig.jobs.push({
                id: job.id,
                jobConfig: job.config,
                jobState: SAVE_STATE.NOT_SAVED,
                datafeedId: null,
                datafeedConfig: {},
                datafeedState: SAVE_STATE.NOT_SAVED,
                runningState: DATAFEED_STATE.NOT_STARTED,
                errors: []
              });
              $scope.ui.numberOfJobs++;

              // read the groups list from each job and create a deduplicated jobGroups list
              if (job.config.groups && job.config.groups.length) {
                job.config.groups.forEach((group) => {
                  tempGroups[group] = null;
                });
              }
            });
            $scope.formConfig.jobGroups = Object.keys(tempGroups);

            resp.datafeeds.forEach((datafeed) => {
              const job = _.find($scope.formConfig.jobs, { id: datafeed.config.job_id });
              if (job !== undefined) {
                const datafeedId = mlJobService.getDatafeedId(job.id);
                job.datafeedId = datafeedId;
                job.datafeedConfig = datafeed.config;
              }
            });
          }
          // populate the kibana saved objects
          if (resp.kibana) {
            _.each(resp.kibana, (obj, key) => {
              obj.forEach((o) => {
                $scope.formConfig.kibanaObjects[key].push({
                  id: o.id,
                  title: o.title,
                  saveState: SAVE_STATE.NOT_SAVED,
                  config: o.config,
                  exists: false
                });
              });
            });
            // check to see if any of the saved objects already exist.
            // if they do, they are marked as such and greyed out.
            checkIfKibanaObjectsExist($scope.formConfig.kibanaObjects);
          }
        });
    }

    // toggle kibana's timepicker
    $scope.changeUseFullIndexData = function () {
      const shouldEnableTimeFilter = !$scope.formConfig.useFullIndexData;
      if (shouldEnableTimeFilter) {
        timefilter.enableTimeRangeSelector();
      } else {
        timefilter.disableTimeRangeSelector();
      }
      $scope.$applyAsync();
    };

    $scope.changeJobLabelCase = function () {
      $scope.formConfig.jobLabel = $scope.formConfig.jobLabel.toLowerCase();
    };

    $scope.save = function () {
      if (validateJobs()) {
        msgs.clear();
        $scope.overallState = SAVE_STATE.SAVING;
        angular.element('.results').css('opacity', 1);
        // wait 500ms for the results section to fade in.
        window.setTimeout(() => {
        // save jobs,datafeeds and kibana savedObjects
          saveDataRecognizerItems()
            .then(() => {
              const jobIds = $scope.formConfig.jobs.map(job => `'${$scope.formConfig.jobLabel}${job.id}'`);
              const jobIdsString = jobIds.join(',');

              // open jobs and save start datafeeds
              if ($scope.formConfig.startDatafeedAfterSave) {
                startDatafeeds()
                  .then(() => {
                    // everything saved correctly and datafeeds have started.
                    $scope.overallState = SAVE_STATE.SAVED;
                    $scope.resultsUrl = createResultsUrl(
                      jobIdsString,
                      $scope.formConfig.start,
                      $scope.formConfig.end,
                      'explorer');
                  }).catch(() => {
                    $scope.overallState = SAVE_STATE.FAILED;
                  });
              } else {
                // datafeeds didn't need to be started so finish
                $scope.overallState = SAVE_STATE.SAVED;
                $scope.resultsUrl = createResultsUrl(
                  jobIdsString,
                  $scope.formConfig.start,
                  $scope.formConfig.end,
                  'explorer');
              }
            });
        }, 500);
      }
    };

    // call the the setupModuleConfigs endpoint to create the jobs, datafeeds and saved objects
    function saveDataRecognizerItems() {
      return $q((resolve) => {
      // set all jobs, datafeeds and saved objects to a SAVING state
      // i.e. display spinners
        setAllToSaving();

        const prefix = $scope.formConfig.jobLabel;
        const indexPatternName = $scope.formConfig.indexPattern.title;
        const groups = $scope.formConfig.jobGroups;
        ml.setupDataRecognizerConfig({ moduleId, prefix, groups, indexPatternName })
          .then((resp) => {
            if (resp.jobs) {
              $scope.formConfig.jobs.forEach((job) => {
                // check results from saving the jobs
                const jobId = `${prefix}${job.id}`;
                const jobResult = resp.jobs.find(j => j.id === jobId);
                if (jobResult !== undefined) {
                  if (jobResult.success) {
                    job.jobState = SAVE_STATE.SAVED;
                  } else {
                    job.jobState = SAVE_STATE.FAILED;
                    if (jobResult.error && jobResult.error.msg) {
                      job.errors.push(jobResult.error.msg);
                    }
                  }
                } else {
                  job.jobState = SAVE_STATE.FAILED;
                  job.errors.push(`Could not save job ${jobId}`);
                }

                // check results from saving the datafeeds
                const datafeedId = prefixDatafeedId(job.datafeedId, prefix);
                const datafeedResult = resp.datafeeds.find(d => d.id === datafeedId);
                if (datafeedResult !== undefined) {
                  if (datafeedResult.success) {
                    job.datafeedState = SAVE_STATE.SAVED;
                  } else {
                    job.datafeedState = SAVE_STATE.FAILED;
                    if (datafeedResult.error && datafeedResult.error.msg) {
                      job.errors.push(datafeedResult.error.msg);
                    }
                  }
                } else {
                  job.datafeedState = SAVE_STATE.FAILED;
                  job.errors.push(`Could not save datafeed ${datafeedId}`);
                }
              });
            }

            if (resp.kibana) {
              _.each($scope.formConfig.kibanaObjects, (kibanaObject, objName) => {
                kibanaObject.forEach((obj) => {
                  // check the results from saving the saved objects
                  const kibanaObjectResult = resp.kibana[objName].find(o => o.id === obj.id);
                  if (kibanaObjectResult !== undefined) {
                    if (kibanaObjectResult.success || kibanaObjectResult.success === false && kibanaObjectResult.exists === true) {
                      obj.saveState = SAVE_STATE.SAVED;
                    } else {
                      obj.saveState = SAVE_STATE.FAILED;
                    }
                  } else {
                    obj.saveState = SAVE_STATE.FAILED;
                    obj.errors.push(`Could not save ${objName} ${obj.id}`);
                  }
                });
              });
            }
            resolve();
          });
      });
    }

    // loop through all jobs, datafeeds and saved objects and set the save state to SAVING
    function setAllToSaving() {
      $scope.formConfig.jobs.forEach((j) => {
        j.jobState = SAVE_STATE.SAVING;
        j.datafeedState = SAVE_STATE.SAVING;
      });

      _.each($scope.formConfig.kibanaObjects, (kibanaObject) => {
        kibanaObject.forEach((obj) => {
          obj.saveState = SAVE_STATE.SAVING;
        });
      });
    }

    function startDatafeeds() {
      return $q((resolve, reject) => {

        const jobs = $scope.formConfig.jobs;
        const numberOfJobs = jobs.length;

        mlCreateRecognizerJobsService.indexTimeRange($scope.formConfig.indexPattern, $scope.formConfig)
          .then((resp) => {
            if ($scope.formConfig.useFullIndexData) {
              $scope.formConfig.start = resp.start.epoch;
              $scope.formConfig.end = resp.end.epoch;
            } else {
              $scope.formConfig.start = dateMath.parse(timefilter.time.from).valueOf();
              $scope.formConfig.end = dateMath.parse(timefilter.time.to).valueOf();
            }
            let jobsCounter = 0;
            let datafeedCounter = 0;

            open(jobs[jobsCounter]);

            function incrementAndOpen(job) {
              jobsCounter++;
              if (jobsCounter < numberOfJobs) {
                open(jobs[jobsCounter]);
              } else {
                // if the last job failed, reject out of the function
                // so it can be caught higher up
                if (job.runningState === DATAFEED_STATE.FAILED) {
                  reject();
                }
              }
            }

            function open(job) {
              if (job.jobState === SAVE_STATE.FAILED) {
                job.runningState = DATAFEED_STATE.FAILED;
                incrementAndOpen(job);
                return;
              }
              job.runningState = DATAFEED_STATE.STARTING;
              const jobId = $scope.formConfig.jobLabel + job.id;
              mlJobService.openJob(jobId)
                .then(() => {
                  incrementAndOpen(job);
                  start(job);
                }).catch((err) => {
                  console.log('Opening job failed', err);
                  start(job);
                  job.errors.push(err.message);
                  incrementAndOpen(job);
                });
            }

            function start(job) {
              const jobId = $scope.formConfig.jobLabel + job.id;
              const datafeedId = prefixDatafeedId(job.datafeedId, $scope.formConfig.jobLabel);
              mlCreateRecognizerJobsService.startDatafeed(
                datafeedId,
                jobId,
                $scope.formConfig.start,
                $scope.formConfig.end)
                .then(() => {
                  job.runningState = DATAFEED_STATE.STARTED;
                  datafeedCounter++;
                  if (datafeedCounter === numberOfJobs) {
                    resolve();
                  }
                })
                .catch((err) => {
                  console.log('Starting datafeed failed', err);
                  job.errors.push(err.message);
                  job.runningState = DATAFEED_STATE.FAILED;
                  reject(err);
                });
            }
          });
      });
    }


    function checkIfKibanaObjectsExist(kibanaObjects) {
      _.each(kibanaObjects, (objects, type) => {
        objects.forEach((obj) => {
          checkForSavedObject(type, obj)
            .then((result) => {
              if (result) {
                obj.saveState = SAVE_STATE.SAVED;
                obj.exists = true;
              }
            });
        });
      });
    }

    function checkForSavedObject(type, savedObject) {
      return $q((resolve, reject) => {
        let exists = false;
        mlCreateRecognizerJobsService.loadExistingSavedObjects(type)
          .then((resp) => {
            const savedObjects = resp.savedObjects;
            savedObjects.forEach((obj) => {
              if (savedObject.title === obj.attributes.title) {
                exists = true;
                savedObject.id = obj.id;
              }
            });
            resolve(exists);
          }).catch((resp) => {
            console.log('Could not load saved objects', resp);
            reject(resp);
          });
      });
    }

    function validateJobs() {
      let valid = true;
      const checks = $scope.ui.validation.checks;
      _.each(checks, (item) => {
        item.valid = true;
      });

      // add an extra bit to the job label to avoid hitting the rule which states
      // you can't have an id ending in a - or _
      // also to allow an empty label
      const label = `${$scope.formConfig.jobLabel}extra`;

      if (isJobIdValid(label) === false) {
        valid = false;
        checks.jobLabel.valid = false;
        let msg = 'Job label can contain lowercase alphanumeric (a-z and 0-9), hyphens or underscores; ';
        msg += 'must start and end with an alphanumeric character';
        checks.jobLabel.message = msg;
      }
      $scope.formConfig.jobGroups.forEach(group => {
        if (isJobIdValid(group) === false) {
          valid = false;
          checks.groupIds.valid = false;
          let msg = 'Job group names can contain lowercase alphanumeric (a-z and 0-9), hyphens or underscores; ';
          msg += 'must start and end with an alphanumeric character';
          checks.groupIds.message = msg;
        }
      });
      return valid;
    }

    loadJobConfigs();

  });
