import { management } from 'ui/management';
import routes from 'ui/routes';
import { XPackInfoProvider } from 'plugins/xpack_main/services/xpack_info';

import 'plugins/reporting/views/management/jobs';

routes.defaults(/\/management/, {
  resolve: {
    reportingManagementSection: function (Private) {
      const xpackInfo = Private(XPackInfoProvider);
      const kibanaManagementSection = management.getSection('kibana');
      const showReportingLinks = xpackInfo.get('features.reporting.management.showLinks');

      kibanaManagementSection.deregister('reporting');
      if (showReportingLinks) {
        const enableReportingLinks = xpackInfo.get('features.reporting.management.enableLinks');
        const tooltipMessage = xpackInfo.get('features.reporting.management.message');

        let url;
        let tooltip;
        if (enableReportingLinks) {
          url = '#/management/kibana/reporting';
        } else {
          tooltip = tooltipMessage;
        }

        return kibanaManagementSection.register('reporting', {
          order: 15,
          display: 'Reporting',
          url,
          tooltip
        });
      }
    }
  }
});
