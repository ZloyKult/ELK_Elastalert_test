import { get } from 'lodash';
import { BaseWatch } from './base_watch';
import { WATCH_TYPES } from 'plugins/watcher/../common/constants';
import defaultWatchJson from './default_watch.json';

/**
 * {@code JsonWatch} allows a user to create a Watch by writing the raw JSON.
 */
export class JsonWatch extends BaseWatch {
  constructor(props = {}) {
    props.type = WATCH_TYPES.JSON;
    super(props);

    this.watch = get(props, 'watch', defaultWatchJson);
  }

  get upstreamJson() {
    const result = super.upstreamJson;
    Object.assign(result, {
      watch: this.watch
    });

    return result;
  }

  static fromUpstreamJson(upstreamWatch) {
    return new JsonWatch(upstreamWatch);
  }

  static defaultWatchJson =  defaultWatchJson;
  static typeName = 'Advanced Watch';
  static iconClass = '';
  static selectMessage = 'Set up a custom watch in raw JSON.';
  static isCreatable = true;
  static selectSortOrder = 100;
}
