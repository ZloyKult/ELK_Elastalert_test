import { capitalize, get } from 'lodash';
import React from 'react';
import { render } from 'react-dom';
import { uiModules } from 'ui/modules';
import {
  KuiKeyboardAccessible,
  KuiTableRowCell,
  KuiTableRow
} from 'ui_framework/components';
import { KibanaStatusIcon } from 'plugins/monitoring/components/kibana/status_icon';
import { MonitoringTable } from 'plugins/monitoring/components/table';
import { SORT_ASCENDING } from 'monitoring-constants';
import { formatNumber } from '../../../lib/format_number';

const filterFields = [ 'kibana.name', 'kibana.host', 'kibana.status', 'kibana.transport_address' ];
const columns = [
  { title: 'Name', sortKey: 'kibana.name', sortOrder: SORT_ASCENDING },
  { title: 'Status', sortKey: 'kibana.status' },
  { title: 'Load Average', sortKey: 'os.load.1m' },
  { title: 'Memory Size', sortKey: 'process.memory.resident_set_size_in_bytes' },
  { title: 'Requests', sortKey: 'requests.total' },
  { title: 'Response Times', sortKey: 'response_times.average' }
];
const instanceRowFactory = (scope, kbnUrl) => {
  const goToInstance = uuid => {
    scope.$evalAsync(() => {
      kbnUrl.changePath(`/kibana/instances/${uuid}`);
    });
  };

  return function KibanaRow(props) {
    return (
      <KuiTableRow>
        <KuiTableRowCell>
          <div className="monitoringTableCell__name">
            <KuiKeyboardAccessible>
              <a
                className="kuiLink"
                onClick={goToInstance.bind(null, get(props, 'kibana.uuid'))}
                data-test-subj={`kibanaLink-${props.kibana.name}`}
              >
                { props.kibana.name }
              </a>
            </KuiKeyboardAccessible>
          </div>
          <div className="monitoringTableCell__transportAddress">{ get(props, 'kibana.transport_address') }</div>
        </KuiTableRowCell>
        <KuiTableRowCell>
          <div title={`Instance status: ${props.kibana.status}`} className="monitoringTableCell__status">
            <KibanaStatusIcon status={props.kibana.status} availability={props.availability} />&nbsp;
            { !props.availability ? 'Offline' : capitalize(props.kibana.status) }
          </div>
        </KuiTableRowCell>
        <KuiTableRowCell>
          <div className="monitoringTableCell__number">
            { formatNumber(get(props, 'os.load["1m"]'), '0.00') }
          </div>
        </KuiTableRowCell>
        <KuiTableRowCell>
          <div className="monitoringTableCell__number">
            { formatNumber(props.process.memory.resident_set_size_in_bytes, '0.00 b') }
          </div>
        </KuiTableRowCell>
        <KuiTableRowCell>
          <div className="monitoringTableCell__number">
            { formatNumber(props.requests.total, 'int_commas') }
          </div>
        </KuiTableRowCell>
        <KuiTableRowCell>
          <div className="monitoringTableCell__splitNumber">
            { props.response_times.average && (formatNumber(props.response_times.average, 'int_commas') + ' ms avg') }
          </div>
          <div className="monitoringTableCell__splitNumber">
            { formatNumber(props.response_times.max, 'int_commas') } ms max
          </div>
        </KuiTableRowCell>
      </KuiTableRow>
    );
  };
};

const uiModule = uiModules.get('monitoring/directives', []);
uiModule.directive('monitoringKibanaListing', kbnUrl => {
  return {
    restrict: 'E',
    scope: {
      instances: '=',
      pageIndex: '=',
      filterText: '=',
      sortKey: '=',
      sortOrder: '=',
      onNewState: '=',
    },
    link(scope, $el) {

      scope.$watch('instances', (instances = []) => {
        const kibanasTable = (
          <MonitoringTable
            className="kibanaInstancesTable"
            rows={instances}
            pageIndex={scope.pageIndex}
            filterText={scope.filterText}
            sortKey={scope.sortKey}
            sortOrder={scope.sortOrder}
            onNewState={scope.onNewState}
            placeholder="Filter Instances..."
            filterFields={filterFields}
            columns={columns}
            rowComponent={instanceRowFactory(scope, kbnUrl)}
          />
        );
        render(kibanasTable, $el[0]);
      });

    }
  };
});
