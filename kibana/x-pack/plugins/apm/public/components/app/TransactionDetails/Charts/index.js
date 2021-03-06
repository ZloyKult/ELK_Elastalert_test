import { connect } from 'react-redux';
import {
  getResponseTimeSeriesOrEmpty,
  getRpmSeriesOrEmpty
} from '../../../shared/charts/TransactionCharts/selectors';
import Charts from '../../../shared/charts/TransactionCharts';
import { getUrlParams } from '../../../../store/urlParams';
import { getCharts, loadCharts } from '../../../../store/charts';

function mapStateToProps(state = {}) {
  const urlParams = getUrlParams(state);
  const {
    serviceName,
    start,
    end,
    transactionType,
    transactionName
  } = urlParams;
  const charts = getCharts(state, {
    serviceName,
    start,
    end,
    transactionType,
    transactionName
  });

  return {
    urlParams,
    status: charts.status,
    responseTimeSeries: getResponseTimeSeriesOrEmpty({
      start,
      end,
      chartsData: charts.data
    }),
    rpmSeries: getRpmSeriesOrEmpty({
      start,
      end,
      chartsData: charts.data,
      transactionType
    }),
    isEmpty: charts.data.totalHits === 0
  };
}

const mapDispatchToProps = dispatch => ({
  loadCharts: props => {
    const {
      serviceName,
      start,
      end,
      transactionType,
      transactionName
    } = props.urlParams;
    const shouldLoad =
      serviceName &&
      start &&
      end &&
      transactionType &&
      transactionName &&
      !props.status;

    if (shouldLoad) {
      dispatch(
        loadCharts({
          serviceName,
          start,
          end,
          transactionType,
          transactionName
        })
      );
    }
  }
});

export default connect(mapStateToProps, mapDispatchToProps)(Charts);
