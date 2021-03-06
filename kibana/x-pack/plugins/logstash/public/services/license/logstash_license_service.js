import { PLUGIN } from '../../../common/constants';
import { Notifier } from 'ui/notify/notifier';

export class LogstashLicenseService {
  constructor(xpackInfoService, kbnUrlService, $timeout) {
    this.xpackInfoService = xpackInfoService;
    this.kbnUrlService = kbnUrlService;
    this.$timeout = $timeout;

    this.notifier = new Notifier({ location: 'Logstash' });
  }

  get enableLinks() {
    return Boolean(this.xpackInfoService.get(`features.${PLUGIN.ID}.enableLinks`));
  }

  get isAvailable() {
    return Boolean(this.xpackInfoService.get(`features.${PLUGIN.ID}.isAvailable`));
  }

  get isReadOnly() {
    return Boolean(this.xpackInfoService.get(`features.${PLUGIN.ID}.isReadOnly`));
  }

  get message() {
    return this.xpackInfoService.get(`features.${PLUGIN.ID}.message`);
  }

  notifyAndRedirect() {
    this.notifier.error(this.xpackInfoService.get(`features.${PLUGIN.ID}.message`));
    this.kbnUrlService.redirect('/management');
  }

  /**
   * Checks if the license is valid or the license can perform downgraded UI tasks.
   * Otherwise, notifies and redirects.
   */
  checkValidity() {
    return new Promise((resolve, reject) => {
      this.$timeout(() => {
        if (this.isAvailable) {
          return resolve();
        }

        this.notifyAndRedirect();
        return reject();
      }, 10); // To allow latest XHR call to update license info
    });
  }
}
