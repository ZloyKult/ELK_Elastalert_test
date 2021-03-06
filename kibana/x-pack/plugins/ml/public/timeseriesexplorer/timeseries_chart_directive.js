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

/*
 * Chart showing plot time series data, with or without model plot enabled,
 * annotated with anomalies.
 */

import _ from 'lodash';
import $ from 'jquery';
import angular from 'angular';
import d3 from 'd3';
import moment from 'moment';
import numeral from 'numeral';
import 'ui/timefilter';

import { ResizeCheckerProvider } from 'ui/resize_checker';

import { getSeverityWithLow } from 'plugins/ml/util/anomaly_utils';
import {
  drawLineChartDots,
  filterAxisLabels,
  numTicksForDateFormat
} from 'plugins/ml/util/chart_utils';
import { TimeBucketsProvider } from 'ui/time_buckets';
import ContextChartMask from 'plugins/ml/timeseriesexplorer/context_chart_mask';
import 'plugins/ml/filters/format_value';
import { mlEscape } from 'plugins/ml/util/string_utils';

import { uiModules } from 'ui/modules';
const module = uiModules.get('apps/ml');

module.directive('mlTimeseriesChart', function ($compile, $timeout, Private, timefilter,
  mlAnomaliesTableService, formatValueFilter, mlChartTooltipService) {

  function link(scope, element) {

    // Key dimensions for the viz and constituent charts.
    let svgWidth = angular.element('.results-container').width();
    const focusZoomPanelHeight = 25;
    const focusChartHeight = 310;
    const focusHeight = focusZoomPanelHeight + focusChartHeight;
    const contextChartHeight = 60;
    const contextChartLineTopMargin = 3;
    const chartSpacing = 25;
    const swimlaneHeight = 30;
    const margin = { top: 20, right: 10, bottom: 15, left: 40 };
    const svgHeight = focusHeight + contextChartHeight + swimlaneHeight + chartSpacing + margin.top + margin.bottom;
    let vizWidth  = svgWidth  - margin.left - margin.right;

    const FOCUS_CHART_ANOMALY_RADIUS = 7;
    const SCHEDULED_EVENT_MARKER_HEIGHT = 5;

    const ZOOM_INTERVAL_OPTIONS = [
      { duration: moment.duration(1, 'h'), label: '1h' },
      { duration: moment.duration(12, 'h'), label: '12h' },
      { duration: moment.duration(1, 'd'), label: '1d' },
      { duration: moment.duration(1, 'w'), label: '1w' },
      { duration: moment.duration(2, 'w'), label: '2w' },
      { duration: moment.duration(1, 'M'), label: '1M' }];

    // Set up the color scale to use for indicating score.
    const anomalyColorScale = d3.scale.threshold()
      .domain([3, 25, 50, 75, 100])
      .range(['#d2e9f7', '#8bc8fb', '#ffdd00', '#ff7e00', '#fe5050']);

    // Create a gray-toned version of the color scale to use under the context chart mask.
    const anomalyGrayScale = d3.scale.threshold()
      .domain([3, 25, 50, 75, 100])
      .range(['#dce7ed', '#b0c5d6', '#b1a34e', '#b17f4e', '#c88686']);

    const focusXScale = d3.time.scale().range([0, vizWidth]);
    const focusYScale = d3.scale.linear().range([focusHeight, focusZoomPanelHeight]);

    const focusXAxis = d3.svg.axis().scale(focusXScale).orient('bottom')
      .innerTickSize(-focusChartHeight).outerTickSize(0).tickPadding(10);
    const focusYAxis = d3.svg.axis().scale(focusYScale).orient('left')
      .innerTickSize(-vizWidth).outerTickSize(0).tickPadding(10);

    const focusValuesLine = d3.svg.line()
      .x(function (d) { return focusXScale(d.date); })
      .y(function (d) { return focusYScale(d.value); })
      .defined(d => d.value !== null);
    const focusBoundedArea = d3.svg.area()
      .x (function (d) { return focusXScale(d.date) || 1; })
      .y0(function (d) { return focusYScale(d.upper); })
      .y1(function (d) { return focusYScale(d.lower); })
      .defined(d => (d.lower !== null && d.upper !== null));

    let contextXScale = d3.time.scale().range([0, vizWidth]);
    let contextYScale = d3.scale.linear().range([contextChartHeight, contextChartLineTopMargin]);

    const TimeBuckets = Private(TimeBucketsProvider);

    const brush = d3.svg.brush();
    let mask;

    scope.$on('render', () => {
      render();
      drawContextChartSelection();
    });

    scope.$on('renderFocusChart', () => {
      renderFocusChart();
    });

    // Redraw the charts when the container is resize.
    const ResizeChecker = Private(ResizeCheckerProvider);
    const resizeChecker = new ResizeChecker(angular.element('.ml-timeseries-chart'));
    resizeChecker.on('resize', () => {
      render();
      drawContextChartSelection();
      renderFocusChart();
    });

    // Listeners for mouseenter/leave events for rows in the table
    // to highlight the corresponding anomaly mark in the focus chart.
    const tableRecordMousenterListener = function (record) {
      highlightFocusChartAnomaly(record);
    };

    const tableRecordMouseleaveListener = function (record) {
      unhighlightFocusChartAnomaly(record);
    };

    mlAnomaliesTableService.anomalyRecordMouseenter.watch(tableRecordMousenterListener);
    mlAnomaliesTableService.anomalyRecordMouseleave.watch(tableRecordMouseleaveListener);

    element.on('$destroy', () => {
      mlAnomaliesTableService.anomalyRecordMouseenter.unwatch(tableRecordMousenterListener);
      mlAnomaliesTableService.anomalyRecordMouseleave.unwatch(tableRecordMouseleaveListener);
      resizeChecker.destroy();
      scope.$destroy();
    });

    function render() {
      // Clear any existing elements from the visualization,
      // then build the svg elements for the bubble chart.
      const chartElement = d3.select(element.get(0));
      chartElement.selectAll('*').remove();

      if (scope.contextChartData === undefined) {
        return;
      }

      // Set the size of the components according to the width of the parent container at render time.
      svgWidth = Math.max(angular.element('.results-container').width(), 0);

      const svg = chartElement.append('svg')
        .attr('width',  svgWidth)
        .attr('height', svgHeight);

      // Set the size of the left margin according to the width of the largest y axis tick label.
      // Temporarily set the domain of the focus y axis to the full data range so that we can
      // measure the maximum tick label width on temporary text elements.
      if (scope.modelPlotEnabled === true ||
        (scope.contextForecastData !== undefined && scope.contextForecastData.length > 0)) {
        const combinedData = scope.contextForecastData === undefined ?
          scope.contextChartData : scope.contextChartData.concat(scope.contextForecastData);

        focusYScale.domain([
          d3.min(combinedData, (d) => {
            return Math.min(d.value, d.lower);
          }),
          d3.max(combinedData, (d) => {
            return Math.max(d.value, d.upper);
          })
        ]);
      } else {
        focusYScale.domain([
          d3.min(scope.contextChartData, (d) => d.value),
          d3.max(scope.contextChartData, (d) => d.value)
        ]);
      }

      let maxYAxisLabelWidth = 0;
      const tempLabelText = svg.append('g')
        .attr('class', 'temp-axis-label tick');
      tempLabelText.selectAll('text.temp.axis').data(focusYScale.ticks())
        .enter()
        .append('text')
        .text(function (d) {
          return focusYScale.tickFormat()(d);
        })
        .each(function () {
          maxYAxisLabelWidth = Math.max(this.getBBox().width + focusYAxis.tickPadding(), maxYAxisLabelWidth);
        })
        .remove();
      d3.select('.temp-axis-label').remove();

      margin.left = (Math.max(maxYAxisLabelWidth, 40));
      vizWidth  = Math.max(svgWidth  - margin.left - margin.right, 0);
      focusXScale.range([0, vizWidth]);
      focusYAxis.innerTickSize(-vizWidth);

      const focus = svg.append('g')
        .attr('class', 'focus-chart')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      const context = svg.append('g')
        .attr('class', 'context-chart')
        .attr('transform', 'translate(' + margin.left + ',' + (focusHeight + margin.top + chartSpacing) + ')');

      // Draw each of the component elements.
      createFocusChart(focus, vizWidth, focusHeight);
      drawContextElements(context, vizWidth, contextChartHeight, swimlaneHeight);
    }

    function drawContextChartSelection() {
      if (scope.contextChartData === undefined) {
        return;
      }

      // Make appropriate selection in the context chart to trigger loading of the focus chart.
      let focusLoadFrom;
      let focusLoadTo;
      const contextXMin = contextXScale.domain()[0].getTime();
      const contextXMax = contextXScale.domain()[1].getTime();

      let combinedData = scope.contextChartData;
      if (scope.contextForecastData !== undefined) {
        combinedData = combinedData.concat(scope.contextForecastData);
      }

      if (scope.zoomFrom) {
        focusLoadFrom = scope.zoomFrom.getTime();
      } else {
        focusLoadFrom = _.reduce(combinedData, (memo, point) =>
          Math.min(memo, point.date.getTime()), new Date(2099, 12, 31).getTime());
      }
      focusLoadFrom = Math.max(focusLoadFrom, contextXMin);

      if (scope.zoomTo) {
        focusLoadTo = scope.zoomTo.getTime();
      } else {
        focusLoadTo = _.reduce(combinedData, (memo, point) => Math.max(memo, point.date.getTime()), 0);
      }
      focusLoadTo = Math.min(focusLoadTo, contextXMax);

      if ((focusLoadFrom !== contextXMin) || (focusLoadTo !== contextXMax)) {
        setContextBrushExtent(new Date(focusLoadFrom), new Date(focusLoadTo), true);
      } else {
        // Don't set the brush if the selection is the full context chart domain.
        setBrushVisibility(false);
        const selectedBounds = contextXScale.domain();
        scope.selectedBounds = { min: moment(new Date(selectedBounds[0])), max: moment(selectedBounds[1]) };
        scope.$root.$broadcast('contextChartSelected', { from: selectedBounds[0], to: selectedBounds[1] });
      }
    }

    function createFocusChart(fcsGroup, fcsWidth, fcsHeight) {
      // Split out creation of the focus chart from the rendering,
      // as we want to re-render the paths and points when the zoom area changes.

      // Add a group at the top to display info on the chart aggregation interval
      // and links to set the brush span to 1h, 1d, 1w etc.
      const zoomGroup = fcsGroup.append('g')
        .attr('class', 'focus-zoom');
      zoomGroup.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', fcsWidth)
        .attr('height', focusZoomPanelHeight)
        .attr('class', 'chart-border');
      createZoomInfoElements(zoomGroup, fcsWidth);

      // Add border round plot area.
      fcsGroup.append('rect')
        .attr('x', 0)
        .attr('y', focusZoomPanelHeight)
        .attr('width', fcsWidth)
        .attr('height', focusChartHeight)
        .attr('class', 'chart-border');

      // Add background for x axis.
      const xAxisBg = fcsGroup.append('g')
        .attr('class', 'x-axis-background');
      xAxisBg.append('rect')
        .attr('x', 0)
        .attr('y', fcsHeight)
        .attr('width', fcsWidth)
        .attr('height', chartSpacing);
      xAxisBg.append('line')
        .attr('x1', 0)
        .attr('y1', fcsHeight)
        .attr('x2', 0)
        .attr('y2', fcsHeight + chartSpacing);
      xAxisBg.append('line')
        .attr('x1', fcsWidth)
        .attr('y1', fcsHeight)
        .attr('x2', fcsWidth)
        .attr('y2', fcsHeight + chartSpacing);
      xAxisBg.append('line')
        .attr('x1', 0)
        .attr('y1', fcsHeight + chartSpacing)
        .attr('x2', fcsWidth)
        .attr('y2', fcsHeight + chartSpacing);


      const axes = fcsGroup.append('g');
      axes.append('g')
        .attr('class', 'x axis')
        .attr('transform', 'translate(0,' + fcsHeight + ')');
      axes.append('g')
        .attr('class', 'y axis');

      // Create the elements for the metric value line and model bounds area.
      fcsGroup.append('path')
        .attr('class', 'area bounds');
      fcsGroup.append('path')
        .attr('class', 'values-line');
      fcsGroup.append('g')
        .attr('class', 'focus-chart-markers');


      // Create the path elements for the forecast value line and bounds area.
      if (scope.contextForecastData) {
        fcsGroup.append('path')
          .attr('class', 'area forecast');
        fcsGroup.append('path')
          .attr('class', 'values-line forecast');
        fcsGroup.append('g')
          .attr('class', 'focus-chart-markers forecast');
      }


      fcsGroup.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', fcsWidth)
        .attr('height', fcsHeight + 24)
        .attr('class', 'chart-border chart-border-highlight');
    }

    function renderFocusChart() {
      if (scope.focusChartData === undefined) {
        return;
      }

      const data = scope.focusChartData;

      const focusChart = d3.select('.focus-chart');

      // Update the plot interval labels.
      const focusAggInt = scope.focusAggregationInterval.expression;
      const bucketSpan = scope.selectedJob.analysis_config.bucket_span;
      angular.element('.zoom-aggregation-interval').text(
        `(aggregation interval: ${focusAggInt}, bucket span: ${bucketSpan})`);

      // Render the axes.

      // Calculate the x axis domain.
      // Elasticsearch aggregation returns points at start of bucket,
      // so set the x-axis min to the start of the first aggregation interval,
      // and the x-axis max to the end of the last aggregation interval.
      const bounds = scope.selectedBounds;
      const aggMs = scope.focusAggregationInterval.asMilliseconds();
      const earliest = moment(Math.floor((bounds.min.valueOf()) / aggMs) * aggMs);
      const latest = moment(Math.ceil((bounds.max.valueOf()) / aggMs) * aggMs);
      focusXScale.domain([earliest.toDate(), latest.toDate()]);

      // Calculate the y-axis domain.
      if (scope.focusChartData.length > 0 ||
        (scope.focusForecastData !== undefined && scope.focusForecastData.length > 0)) {
        // Use default tick formatter.
        focusYAxis.tickFormat(null);

        // Calculate the min/max of the metric data and the forecast data.
        let yMin = 0;
        let yMax = 0;

        let combinedData = data;
        if (scope.focusForecastData !== undefined && scope.focusForecastData.length > 0) {
          combinedData = data.concat(scope.focusForecastData);
        }

        yMin = d3.min(combinedData, (d) => {
          return d.lower !== undefined ? Math.min(d.value, d.lower) : d.value;
        });
        yMax = d3.max(combinedData, (d) => {
          return d.upper !== undefined ? Math.max(d.value, d.upper) : d.value;
        });

        if (yMax === yMin) {
          if (
            contextYScale.domain()[0] !== contextYScale.domain()[1] &&
            yMin >= contextYScale.domain()[0] && yMax <= contextYScale.domain()[1]
          ) {
            // Set the focus chart limits to be the same as the context chart.
            yMin = contextYScale.domain()[0];
            yMax = contextYScale.domain()[1];
          } else {
            yMin -= (yMin * 0.05);
            yMax += (yMax * 0.05);
          }
        }

        focusYScale.domain([yMin, yMax]);

      } else {
        // Display 10 unlabelled ticks.
        focusYScale.domain([0, 10]);
        focusYAxis.tickFormat('');
      }

      // Get the scaled date format to use for x axis tick labels.
      const timeBuckets = new TimeBuckets();
      timeBuckets.setInterval('auto');
      timeBuckets.setBounds(bounds);
      const xAxisTickFormat = timeBuckets.getScaledDateFormat();
      focusChart.select('.x.axis')
        .call(focusXAxis.ticks(numTicksForDateFormat(vizWidth), xAxisTickFormat)
          .tickFormat((d) => {
            return moment(d).format(xAxisTickFormat);
          }));
      focusChart.select('.y.axis')
        .call(focusYAxis);

      filterAxisLabels(focusChart.select('.x.axis'), vizWidth);

      // Render the bounds area and values line.
      if (scope.modelPlotEnabled === true) {
        focusChart.select('.area.bounds')
          .attr('d', focusBoundedArea(data))
          .classed('hidden', !scope.showModelBounds);
      }

      focusChart.select('.values-line')
        .attr('d', focusValuesLine(data));
      drawLineChartDots(data, focusChart, focusValuesLine);

      // Render circle markers for the points.
      // These are used for displaying tooltips on mouseover.
      // Don't render dots where value=null (data gaps)
      const dots = d3.select('.focus-chart-markers').selectAll('.metric-value')
        .data(data.filter(d => d.value !== null));

      // Remove dots that are no longer needed i.e. if number of chart points has decreased.
      dots.exit().remove();
      // Create any new dots that are needed i.e. if number of chart points has increased.
      dots.enter().append('circle')
        .attr('r', FOCUS_CHART_ANOMALY_RADIUS)
        .on('mouseover', function (d) {
          showFocusChartTooltip(d, this);
        })
        .on('mouseout', () => mlChartTooltipService.hide());

      // Update all dots to new positions.
      dots.attr('cx', (d) => { return focusXScale(d.date); })
        .attr('cy', (d) => { return focusYScale(d.value); })
        .attr('class', (d) => {
          let markerClass = 'metric-value';
          if (_.has(d, 'anomalyScore')) {
            markerClass += ' anomaly-marker ';
            markerClass += getSeverityWithLow(d.anomalyScore);
          }
          return markerClass;
        });

      // Add rectangular markers for any scheduled events.
      const scheduledEventMarkers = d3.select('.focus-chart-markers').selectAll('.scheduled-event-marker')
        .data(data.filter(d => d.scheduledEvents !== undefined));

      // Remove markers that are no longer needed i.e. if number of chart points has decreased.
      scheduledEventMarkers.exit().remove();

      // Create any new markers that are needed i.e. if number of chart points has increased.
      scheduledEventMarkers.enter().append('rect')
        .attr('width', FOCUS_CHART_ANOMALY_RADIUS * 2)
        .attr('height', SCHEDULED_EVENT_MARKER_HEIGHT)
        .attr('class', 'scheduled-event-marker')
        .attr('rx', 1)
        .attr('ry', 1);

      // Update all markers to new positions.
      scheduledEventMarkers.attr('x', (d) => focusXScale(d.date) - FOCUS_CHART_ANOMALY_RADIUS)
        .attr('y', (d) => focusYScale(d.value) - 3);

      // Plot any forecast data in scope.
      if (scope.focusForecastData !== undefined) {
        focusChart.select('.area.forecast')
          .attr('d', focusBoundedArea(scope.focusForecastData))
          .classed('hidden', !scope.showForecast);
        focusChart.select('.values-line.forecast')
          .attr('d', focusValuesLine(scope.focusForecastData))
          .classed('hidden', !scope.showForecast);

        const forecastDots = d3.select('.focus-chart-markers.forecast').selectAll('.metric-value')
          .data(scope.focusForecastData);

        // Remove dots that are no longer needed i.e. if number of forecast points has decreased.
        forecastDots.exit().remove();
        // Create any new dots that are needed i.e. if number of forecast points has increased.
        forecastDots.enter().append('circle')
          .attr('r', FOCUS_CHART_ANOMALY_RADIUS)
          .on('mouseover', function (d) {
            showFocusChartTooltip(d, this);
          })
          .on('mouseout', () => mlChartTooltipService.hide());

        // Update all dots to new positions.
        forecastDots.attr('cx', (d) => { return focusXScale(d.date); })
          .attr('cy', (d) => { return focusYScale(d.value); })
          .attr('class', 'metric-value')
          .classed('hidden', !scope.showForecast);
      }

    }

    function createZoomInfoElements(zoomGroup, fcsWidth) {
      // Create zoom duration links applicable for the current time span.
      // Don't add links for any durations which would give a brush extent less than 10px.
      const bounds = timefilter.getActiveBounds();
      const boundsSecs = bounds.max.unix() - bounds.min.unix();
      const minSecs = (10 / vizWidth) * boundsSecs;

      let xPos = 10;
      const zoomLabel = zoomGroup.append('text')
        .attr('x', xPos)
        .attr('y', 17)
        .attr('class', 'zoom-info-text')
        .text('Zoom:');

      const zoomOptions = [{ durationMs: scope.autoZoomDuration, label: 'auto' }];
      _.each(ZOOM_INTERVAL_OPTIONS, (option) => {
        if (option.duration.asSeconds() > minSecs &&
            option.duration.asSeconds() < boundsSecs) {
          zoomOptions.push({ durationMs: option.duration.asMilliseconds(), label: option.label });
        }
      });
      xPos += (zoomLabel.node().getBBox().width + 4);

      _.each(zoomOptions, (option) => {
        const text = zoomGroup.append('a')
          .attr('data-ms', option.durationMs)
          .attr('href', '')
          .append('text')
          .attr('x', xPos)
          .attr('y', 17)
          .attr('class', 'zoom-info-text')
          .text(option.label);

        xPos += (text.node().getBBox().width + 4);
      });

      zoomGroup.append('text')
        .attr('x', (xPos + 6))
        .attr('y', 17)
        .attr('class', 'zoom-info-text zoom-aggregation-interval')
        .text('(aggregation interval: , bucket span: )');

      if (scope.modelPlotEnabled === false) {
        const modelPlotLabel = zoomGroup.append('text')
          .attr('x', 300)
          .attr('y', 17)
          .attr('class', 'zoom-info-text')
          .text('Model bounds are not available');

        modelPlotLabel.attr('x', (fcsWidth - (modelPlotLabel.node().getBBox().width + 10)));
      }

      $('.focus-zoom a').click(function (e) {
        e.preventDefault();
        setZoomInterval($(this).attr('data-ms'));
      });
    }

    function drawContextElements(cxtGroup, cxtWidth, cxtChartHeight, swlHeight) {
      const data = scope.contextChartData;

      contextXScale = d3.time.scale().range([0, cxtWidth])
        .domain(calculateContextXAxisDomain());

      const combinedData = scope.contextForecastData === undefined ? data : data.concat(scope.contextForecastData);
      const valuesRange = { min: Number.MAX_VALUE, max: Number.MIN_VALUE };
      _.each(combinedData, (item) => {
        valuesRange.min = Math.min(item.value, valuesRange.min);
        valuesRange.max = Math.max(item.value, valuesRange.max);
      });
      let dataMin = valuesRange.min;
      let dataMax = valuesRange.max;
      const chartLimits = { min: dataMin, max: dataMax };

      if (scope.modelPlotEnabled === true ||
        (scope.contextForecastData !== undefined && scope.contextForecastData.length > 0)) {
        const boundsRange = { min: Number.MAX_VALUE, max: Number.MIN_VALUE };
        _.each(combinedData, (item) => {
          boundsRange.min = Math.min(item.lower, boundsRange.min);
          boundsRange.max = Math.max(item.upper, boundsRange.max);
        });
        dataMin = Math.min(dataMin, boundsRange.min);
        dataMax = Math.max(dataMax, boundsRange.max);

        // Set the y axis domain so that the range of actual values takes up at least 50% of the full range.
        if ((valuesRange.max - valuesRange.min) < 0.5 * (dataMax - dataMin)) {
          if (valuesRange.min > dataMin) {
            chartLimits.min = valuesRange.min - (0.5 * (valuesRange.max - valuesRange.min));
          }

          if (valuesRange.max < dataMax) {
            chartLimits.max = valuesRange.max + (0.5 * (valuesRange.max - valuesRange.min));
          }
        }
      }

      contextYScale = d3.scale.linear().range([cxtChartHeight, contextChartLineTopMargin])
        .domain([chartLimits.min, chartLimits.max]);

      const borders = cxtGroup.append('g')
        .attr('class', 'axis');

      // Add borders left and right.
      borders.append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', 0)
        .attr('y2', cxtChartHeight + swlHeight);
      borders.append('line')
        .attr('x1', cxtWidth)
        .attr('y1', 0)
        .attr('x2', cxtWidth)
        .attr('y2', cxtChartHeight + swlHeight);

      // Add x axis.
      const bounds = timefilter.getActiveBounds();
      const timeBuckets = new TimeBuckets();
      timeBuckets.setInterval('auto');
      timeBuckets.setBounds(bounds);
      const xAxisTickFormat = timeBuckets.getScaledDateFormat();
      const xAxis = d3.svg.axis().scale(contextXScale)
        .orient('top')
        .innerTickSize(-cxtChartHeight)
        .outerTickSize(0)
        .tickPadding(0)
        .ticks(numTicksForDateFormat(cxtWidth, xAxisTickFormat))
        .tickFormat((d) => {
          return moment(d).format(xAxisTickFormat);
        });

      cxtGroup.datum(data);

      const contextBoundsArea = d3.svg.area()
        .x((d) => { return contextXScale(d.date); })
        .y0((d) => { return contextYScale(Math.min(chartLimits.max, Math.max(d.lower, chartLimits.min))); })
        .y1((d) => { return contextYScale(Math.max(chartLimits.min, Math.min(d.upper, chartLimits.max))); })
        .defined(d => (d.lower !== null && d.upper !== null));

      if (scope.modelPlotEnabled === true) {
        cxtGroup.append('path')
          .datum(data)
          .attr('class', 'area context')
          .attr('d', contextBoundsArea);
      }

      const contextValuesLine = d3.svg.line()
        .x((d) => { return contextXScale(d.date); })
        .y((d) => { return contextYScale(d.value); })
        .defined(d => d.value !== null);

      cxtGroup.append('path')
        .datum(data)
        .attr('class', 'values-line')
        .attr('d', contextValuesLine);
      drawLineChartDots(data, cxtGroup, contextValuesLine, 1);

      // Create the path elements for the forecast value line and bounds area.
      if (scope.contextForecastData !== undefined) {
        cxtGroup.append('path')
          .datum(scope.contextForecastData)
          .attr('class', 'area forecast')
          .attr('d', contextBoundsArea);
        cxtGroup.append('path')
          .datum(scope.contextForecastData)
          .attr('class', 'values-line forecast')
          .attr('d', contextValuesLine);
      }

      // Create and draw the anomaly swimlane.
      const swimlane = cxtGroup.append('g')
        .attr('class', 'swimlane')
        .attr('transform', 'translate(0,' + cxtChartHeight + ')');

      drawSwimlane(swimlane, cxtWidth, swlHeight);

      // Draw a mask over the sections of the context chart and swimlane
      // which fall outside of the zoom brush selection area.
      mask = new ContextChartMask(cxtGroup, scope.contextChartData, scope.modelPlotEnabled, swlHeight)
        .x(contextXScale)
        .y(contextYScale);

      // Draw the x axis on top of the mask so that the labels are visible.
      cxtGroup.append('g')
        .attr('class', 'x axis context-chart-axis')
        .call(xAxis);

      // Move the x axis labels up so that they are inside the contact chart area.
      cxtGroup.selectAll('.x.context-chart-axis text')
        .attr('dy', (cxtChartHeight - 5));

      filterAxisLabels(cxtGroup.selectAll('.x.context-chart-axis'), cxtWidth);

      drawContextBrush(cxtGroup);
    }

    function drawContextBrush(contextGroup) {
      // Create the brush for zooming in to the focus area of interest.
      brush.x(contextXScale)
        .on('brush', brushing)
        .on('brushend', brushed);

      contextGroup.append('g')
        .attr('class', 'x brush')
        .call(brush)
        .selectAll('rect')
        .attr('y', -1)
        .attr('height', contextChartHeight + swimlaneHeight + 1);

      // move the left and right resize areas over to
      // be under the handles
      contextGroup.selectAll('.w rect')
        .attr('x', -10)
        .attr('width', 10);

      contextGroup.selectAll('.e rect')
        .attr('x', 0)
        .attr('width', 10);

      const topBorder = contextGroup.append('rect')
        .attr('class', 'top-border')
        .attr('y', -2)
        .attr('height', contextChartLineTopMargin);

      // Draw the brush handles using SVG foreignObject elements.
      // Note these are not supported on IE11 and below, so will not appear in IE.
      const leftHandle = contextGroup.append('foreignObject')
        .attr('width', 10)
        .attr('height', 90)
        .attr('class', 'brush-handle')
        .html('<div class="brush-handle-inner brush-handle-inner-left"><i class="fa fa-caret-left"></i></div>');
      const rightHandle = contextGroup.append('foreignObject')
        .attr('width', 10)
        .attr('height', 90)
        .attr('class', 'brush-handle')
        .html('<div class="brush-handle-inner brush-handle-inner-right"><i class="fa fa-caret-right"></i></div>');

      setBrushVisibility(!brush.empty());

      function showBrush(show) {
        if (show === true) {
          const brushExtent = brush.extent();
          mask.reveal(brushExtent);
          leftHandle.attr('x', contextXScale(brushExtent[0]) - 10);
          rightHandle.attr('x', contextXScale(brushExtent[1]) + 0);

          topBorder.attr('x', contextXScale(brushExtent[0]) + 1);
          topBorder.attr('width', contextXScale(brushExtent[1]) - contextXScale(brushExtent[0]) - 2);
        }

        setBrushVisibility(show);
      }

      function brushing() {
        const isEmpty = brush.empty();
        showBrush(!isEmpty);
      }

      function brushed() {
        const isEmpty = brush.empty();
        showBrush(!isEmpty);

        const selectedBounds = isEmpty ? contextXScale.domain() : brush.extent();
        const selectionMin = selectedBounds[0].getTime();
        const selectionMax = selectedBounds[1].getTime();

        // Set the color of the swimlane cells according to whether they are inside the selection.
        contextGroup.selectAll('.swimlane-cell')
          .style('fill', (d) => {
            const cellMs = d.date.getTime();
            if (cellMs < selectionMin || cellMs > selectionMax) {
              return anomalyGrayScale(d.score);
            } else {
              return anomalyColorScale(d.score);
            }
          });

        scope.selectedBounds = { min: moment(selectionMin), max: moment(selectionMax) };
        scope.$root.$broadcast('contextChartSelected', { from: selectedBounds[0], to: selectedBounds[1] });
      }
    }

    function setBrushVisibility(show) {
      if (mask !== undefined) {
        const visibility = show ? 'visible' : 'hidden';
        mask.style('visibility', visibility);

        d3.selectAll('.brush').style('visibility', visibility);

        const brushHandles = d3.selectAll('.brush-handle-inner');
        brushHandles.style('visibility', visibility);

        const topBorder = d3.selectAll('.top-border');
        topBorder.style('visibility', visibility);

        const border = d3.selectAll('.chart-border-highlight');
        border.style('visibility', visibility);
      }
    }

    function drawSwimlane(swlGroup, swlWidth, swlHeight) {
      const data = scope.swimlaneData;

      // Calculate the x axis domain.
      // Elasticsearch aggregation returns points at start of bucket, so set the
      // x-axis min to the start of the aggregation interval.
      // Need to use the min(earliest) and max(earliest) of the context chart
      // aggregation to align the axes of the chart and swimlane elements.
      const xAxisDomain = calculateContextXAxisDomain();
      const x = d3.time.scale().range([0, swlWidth])
        .domain(xAxisDomain);

      const y = d3.scale.linear().range([swlHeight, 0])
        .domain([0, swlHeight]);

      const xAxis = d3.svg.axis()
        .scale(x)
        .orient('bottom')
        .innerTickSize(-swlHeight)
        .outerTickSize(0);

      const yAxis = d3.svg.axis()
        .scale(y)
        .orient('left')
        .tickValues(y.domain())
        .innerTickSize(-swlWidth)
        .outerTickSize(0);

      const axes = swlGroup.append('g');

      axes.append('g')
        .attr('class', 'x axis')
        .attr('transform', 'translate(0,' + (swlHeight) + ')')
        .call(xAxis);

      axes.append('g')
        .attr('class', 'y axis')
        .call(yAxis);

      const earliest = xAxisDomain[0].getTime();
      const latest = xAxisDomain[1].getTime();
      const swimlaneAggMs = scope.contextAggregationInterval.asMilliseconds();
      let cellWidth = swlWidth / ((latest - earliest) / swimlaneAggMs);
      if (cellWidth < 1) {
        cellWidth = 1;
      }

      const cells = swlGroup.append('g')
        .attr('class', 'swimlane-cells')
        .selectAll('cells')
        .data(data);

      cells.enter().append('rect')
        .attr('x', (d) => { return x(d.date); })
        .attr('y', 0)
        .attr('rx', 0)
        .attr('ry', 0)
        .attr('class', (d) => { return d.score > 0 ? 'swimlane-cell' : 'swimlane-cell-hidden';})
        .attr('width', cellWidth)
        .attr('height', swlHeight)
        .style('fill', (d) => { return anomalyColorScale(d.score);});

    }

    function calculateContextXAxisDomain() {
      // Calculates the x axis domain for the context elements.
      // Elasticsearch aggregation returns points at start of bucket,
      // so set the x-axis min to the start of the first aggregation interval,
      // and the x-axis max to the end of the last aggregation interval.
      // Context chart and swimlane use the same aggregation interval.
      const bounds = timefilter.getActiveBounds();
      let earliest = bounds.min.valueOf();

      if (scope.swimlaneData !== undefined && scope.swimlaneData.length > 0) {
        // Adjust the earliest back to the time of the first swimlane point
        // if this is before the time filter minimum.
        earliest = Math.min(_.first(scope.swimlaneData).date.getTime(), bounds.min.valueOf());
      }

      const contextAggMs = scope.contextAggregationInterval.asMilliseconds();
      const earliestMs = Math.floor(earliest / contextAggMs) * contextAggMs;
      const latestMs = Math.ceil((bounds.max.valueOf()) / contextAggMs) * contextAggMs;

      return [new Date(earliestMs), new Date(latestMs)];
    }

    // Sets the extent of the brush on the context chart to the
    // supplied from and to Date objects.
    function setContextBrushExtent(from, to, fireEvent) {
      brush.extent([from, to]);
      brush(d3.select('.brush'));
      if (fireEvent) {
        brush.event(d3.select('.brush'));
      }
    }

    function setZoomInterval(ms) {
      const bounds = timefilter.getActiveBounds();
      const minBoundsMs = bounds.min.valueOf();
      const maxBoundsMs = bounds.max.valueOf();

      // Attempt to retain the same zoom end time.
      // If not, go back to the bounds start and add on the required millis.
      const millis = +ms;
      let to = scope.zoomTo.getTime();
      let from = to - millis;
      if (from < minBoundsMs) {
        from = minBoundsMs;
        to = Math.min(minBoundsMs + millis, maxBoundsMs);
      }

      setContextBrushExtent(new Date(from), new Date(to), true);
    }

    function showFocusChartTooltip(marker, circle) {
      // Show the time and metric values in the tooltip.
      // Uses date, value, upper, lower and anomalyScore (optional) marker properties.
      const formattedDate = moment(marker.date).format('MMMM Do YYYY, HH:mm');
      let contents = formattedDate + '<br/><hr/>';

      if (_.has(marker, 'anomalyScore')) {
        const score = parseInt(marker.anomalyScore);
        const displayScore = (score > 0 ? score : '< 1');
        contents += `anomaly score: ${displayScore}<br/>`;

        if (scope.modelPlotEnabled === false) {
          if (_.has(marker, 'actual')) {
            // Display the record actual in preference to the chart value, which may be
            // different depending on the aggregation interval of the chart.
            contents += `actual: ${formatValueFilter(marker.actual, marker.function)}`;
            contents += `<br/>typical: ${formatValueFilter(marker.typical, marker.function)}`;
          } else {
            contents += `value: ${numeral(marker.value).format('0,0.[00]')}`;
            if (_.has(marker, 'byFieldName') && _.has(marker, 'numberOfCauses')) {
              const numberOfCauses = marker.numberOfCauses;
              const byFieldName = mlEscape(marker.byFieldName);
              if (numberOfCauses < 10) {
                // If numberOfCauses === 1, won't go into this block as actual/typical copied to top level fields.
                contents += `<br/> ${numberOfCauses} unusual ${byFieldName} values`;
              } else {
                // Maximum of 10 causes are stored in the record, so '10' may mean more than 10.
                contents += `<br/> ${numberOfCauses}+ unusual ${byFieldName} values`;
              }
            }
          }
        } else {
          contents += `value: ${numeral(marker.value).format('0,0.[00]')}`;
          contents += `<br/>upper bounds: ${numeral(marker.upper).format('0,0.[00]')}`;
          contents += `<br/>lower bounds: ${numeral(marker.lower).format('0,0.[00]')}`;
        }
      } else {
        // TODO - need better formatting for small decimals.
        if (_.get(marker, 'isForecast', false) === true) {
          contents += `prediction: ${numeral(marker.value).format('0,0.[00]')}`;
        } else {
          contents += `value: ${numeral(marker.value).format('0,0.[00]')}`;
        }

        if (scope.modelPlotEnabled === true) {
          contents += `<br/>upper bounds: ${numeral(marker.upper).format('0,0.[00]')}`;
          contents += `<br/>lower bounds: ${numeral(marker.lower).format('0,0.[00]')}`;
        }
      }

      if (_.has(marker, 'scheduledEvents')) {
        contents += `<br/><hr/>Scheduled events:<br/>${marker.scheduledEvents.map(mlEscape).join('<br/>')}`;
      }

      mlChartTooltipService.show(contents, circle, {
        x: FOCUS_CHART_ANOMALY_RADIUS * 2,
        y: 0
      });
    }

    function highlightFocusChartAnomaly(record) {
      // Highlights the anomaly marker in the focus chart corresponding to the specified record.

      // Find the anomaly marker which is closest in time to the source record.
      // Depending on the way the chart is aggregated, there may not be
      // a point at exactly the same time as the record being highlighted.
      const anomalyTime = record.source.timestamp;

      const chartData = scope.focusChartData;
      let previousMarker = chartData[0];
      let markerToSelect = chartData[0];
      for (let i = 0; i < chartData.length; i++) {
        const chartItem = chartData[i];
        const markerTime = chartItem.date.getTime();
        // Check against all chart points i.e. including those which don't have an anomaly marker, as
        // there can be records with very low scores where the corresponding bucket anomaly score is 0.
        if (markerTime === anomalyTime) {
          markerToSelect = chartItem;
          break;
        } else {
          if (markerTime > anomalyTime) {
            markerToSelect = previousMarker;
            break;
          }
        }
        markerToSelect = chartItem;   // Ensures last marker is selected if record is most recent in list.
        previousMarker = chartItem;
      }

      // Render an additional highlighted anomaly marker on the focus chart.
      // TODO - plot anomaly markers for cases where there is an anomaly due
      // to the absence of data and model plot is enabled.
      if (markerToSelect !== undefined) {
        const selectedMarker = d3.select('.focus-chart-markers').selectAll('.focus-chart-highlighted-marker')
          .data([markerToSelect]);
        selectedMarker.enter().append('circle')
          .attr('r', FOCUS_CHART_ANOMALY_RADIUS);
        selectedMarker.attr('cx', (d) => { return focusXScale(d.date); })
          .attr('cy', (d) => { return focusYScale(d.value); })
          .attr('class', (d) => {
            let markerClass = 'metric-value anomaly-marker highlighted ';
            markerClass += getSeverityWithLow(d.anomalyScore);
            return markerClass;
          });

        // Display the chart tooltip for this marker.
        // Note the values of the record and marker may differ depending on the levels of aggregation.
        const circle = $('.focus-chart-markers .anomaly-marker.highlighted');
        if (circle.length) {
          showFocusChartTooltip(markerToSelect, circle[0]);
        }
      }
    }

    function unhighlightFocusChartAnomaly() {
      d3.select('.focus-chart-markers').selectAll('.anomaly-marker.highlighted').remove();
      mlChartTooltipService.hide();
    }


  }

  return {
    scope: {
      selectedJob: '=',
      modelPlotEnabled: '=',
      contextChartData: '=',
      contextForecastData: '=',
      contextChartAnomalyData: '=',
      focusChartData: '=',
      swimlaneData: '=',
      focusForecastData: '=',
      contextAggregationInterval: '=',
      focusAggregationInterval: '=',
      zoomFrom: '=',
      zoomTo: '=',
      autoZoomDuration: '=',
      showModelBounds: '=',
      showForecast: '='
    },
    link: link
  };
});
