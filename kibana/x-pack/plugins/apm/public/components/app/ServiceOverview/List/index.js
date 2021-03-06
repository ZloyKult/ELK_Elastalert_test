import React, { Component } from 'react';

import FilterableAPMTable from '../../../shared/APMTable/FilterableAPMTable';
import { AlignmentKuiTableHeaderCell } from '../../../shared/APMTable/APMTable';

import ListItem from './ListItem';

class List extends Component {
  render() {
    const { items, changeServiceSorting, serviceSorting } = this.props;

    const renderHead = () => {
      const cells = [
        { key: 'serviceName', label: 'Name' },
        { key: 'agentName', label: 'Agent' },
        {
          key: 'avgResponseTime',
          label: 'Avg. response time',
          alignRight: true
        },
        {
          key: 'transactionsPerMinute',
          label: 'Trans. per minute',
          alignRight: true
        },
        { key: 'errorsPerMinute', label: 'Errors per minute', alignRight: true }
      ].map(({ key, label, alignRight }) => (
        <AlignmentKuiTableHeaderCell
          key={key}
          onSort={() => changeServiceSorting(key)}
          isSorted={serviceSorting.key === key}
          isSortAscending={!serviceSorting.descending}
          className={alignRight ? 'kuiTableHeaderCell--alignRight' : ''}
        >
          {label}
        </AlignmentKuiTableHeaderCell>
      ));

      return cells;
    };

    const renderBody = services => {
      return services.map(service => {
        return <ListItem key={service.serviceName} service={service} />;
      });
    };

    const renderFooterText = () => {
      return items.length === 500 ? 'Only top 500 services are shown' : '';
    };

    return (
      <FilterableAPMTable
        searchableFields={['serviceName', 'agentName']}
        items={items}
        emptyMessageHeading="No services with data in the selected time range."
        renderHead={renderHead}
        renderBody={renderBody}
        renderFooterText={renderFooterText}
      />
    );
  }
}

export default List;
