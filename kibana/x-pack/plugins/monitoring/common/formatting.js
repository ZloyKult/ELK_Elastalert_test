import moment from 'moment-timezone';

export const LARGE_FLOAT = '0,0.[00]';
export const SMALL_FLOAT = '0.[00]';
export const LARGE_BYTES = '0,0.0 b';
export const SMALL_BYTES = '0.0 b';
export const LARGE_ABBREVIATED = '0,0.[0]a';

/**
 * Format the {@code date} in the user's expected date/time format using their <em>guessed</em> local time zone.
 * @param date Either a numeric Unix timestamp or a {@code Date} object
 * @returns The date formatted using 'LL LTS'
 */
export function formatDateTimeLocal(date) {
  return moment.tz(date, moment.tz.guess()).format('LL LTS');
}

/**
 * Shorten a Logstash Pipeline's hash for display purposes
 * @param {string} hash The complete hash
 * @return {string} The shortened hash
 */
export function shortenPipelineHash(hash) {
  return hash.substr(0, 6);
}
