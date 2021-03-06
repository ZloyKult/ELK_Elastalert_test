import React from 'react';
import {
  KuiTable,
  KuiTableRow,
  KuiTableRowCell,
  KuiTableBody,
} from 'ui_framework/components';

export function LatestActive({ latestActive }) {
  const rangeMap = {
    'last1m': 'Last 1 minute',
    'last5m': 'Last 5 minutes',
    'last20m': 'Last 20 minutes',
    'last1h': 'Last 1 hour',
    'last1d': 'Last 1 day',
  };

  const activity = latestActive.map(({ range, count }, index) => {
    return (
      <KuiTableRow key={`latest-active-${index}`}>
        <KuiTableRowCell>{rangeMap[range]}</KuiTableRowCell>
        <KuiTableRowCell align="right">{count}</KuiTableRowCell>
      </KuiTableRow>
    );
  });

  return (
    <KuiTable>
      <KuiTableBody>
        {activity}
      </KuiTableBody>
    </KuiTable>
  );
}
