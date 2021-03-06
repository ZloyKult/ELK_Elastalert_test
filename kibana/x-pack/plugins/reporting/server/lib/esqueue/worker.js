import events from 'events';
import Puid from 'puid';
import moment from 'moment';
import { constants } from './constants';
import { WorkerTimeoutError, UnspecifiedWorkerError } from './helpers/errors';
import { CancellationToken } from './helpers/cancellation_token';
import { Poller } from '../../../../../common/poller';

const puid = new Puid();

function formatJobObject(job) {
  return {
    index: job._index,
    type: job._type,
    id: job._id,
  };
}

export class Worker extends events.EventEmitter {
  constructor(queue, type, workerFn, opts) {
    if (typeof type !== 'string') throw new Error('type must be a string');
    if (typeof workerFn !== 'function') throw new Error('workerFn must be a function');
    if (typeof opts !== 'object') throw new Error('opts must be an object');
    if (typeof opts.interval !== 'number') throw new Error('opts.interval must be a number');
    if (typeof opts.intervalErrorMultiplier !== 'number') throw new Error('opts.intervalErrorMultiplier must be a number');

    super();

    this.id = puid.generate();
    this.queue = queue;
    this.client = opts.client || this.queue.client;
    this.jobtype = type;
    this.workerFn = workerFn;
    this.checkSize = opts.size || 10;
    this.doctype = opts.doctype || constants.DEFAULT_SETTING_DOCTYPE;

    this.debug = (msg, err) => {
      const logger = opts.logger || function () {};

      const message = `${this.id} - ${msg}`;
      const tags = ['worker', 'debug'];

      if (err) {
        logger(`${message}: ${err.stack  ? err.stack : err }`, tags);
        return;
      }

      logger(message, tags);
    };

    this._running = true;
    this.debug(`Created worker for job type ${this.jobtype}`);

    this._poller = new Poller({
      functionToPoll: () => {
        return this._processPendingJobs();
      },
      pollFrequencyInMillis: opts.interval,
      trailing: true,
      continuePollingOnError: true,
      pollFrequencyErrorMultiplier: opts.intervalErrorMultiplier,
    });
    this._startJobPolling();
  }

  destroy() {
    this._running = false;
    this._stopJobPolling();
  }

  toJSON() {
    return {
      id: this.id,
      index: this.queue.index,
      jobType: this.jobType,
      doctype: this.doctype,
    };
  }

  emit(name, ...args) {
    super.emit(name, ...args);
    this.queue.emit(name, ...args);
  }

  _formatErrorParams(err, job) {
    const response = {
      error: err,
      worker: this.toJSON(),
    };

    if (job) response.job = formatJobObject(job);
    return response;
  }

  _claimJob(job) {
    const m = moment();
    const startTime = m.toISOString();
    const expirationTime = m.add(job._source.timeout).toISOString();
    const attempts = job._source.attempts + 1;

    if (attempts > job._source.max_attempts) {
      const msg = (!job._source.output) ? `Max attempts reached (${job._source.max_attempts})` : false;
      return this._failJob(job, msg)
        .then(() => false);
    }

    const doc = {
      attempts: attempts,
      started_at: startTime,
      process_expiration: expirationTime,
      status: constants.JOB_STATUS_PROCESSING,
    };

    return this.client.update({
      index: job._index,
      type: job._type,
      id: job._id,
      version: job._version,
      body: { doc }
    })
      .then((response) => {
        const updatedJob = {
          ...job,
          ...response
        };
        updatedJob._source = {
          ...job._source,
          ...doc
        };
        return updatedJob;
      })
      .catch((err) => {
        if (err.statusCode === 409) return true;
        this.debug(`_claimJob failed on job ${job._id}`, err);
        this.emit(constants.EVENT_WORKER_JOB_CLAIM_ERROR, this._formatErrorParams(err, job));
        return false;
      });
  }

  _failJob(job, output = false) {
    this.debug(`Failing job ${job._id}`);

    const completedTime = moment().toISOString();
    const docOutput = this._formatOutput(output);
    const doc = {
      status: constants.JOB_STATUS_FAILED,
      completed_at: completedTime,
      output: docOutput
    };

    this.emit(constants.EVENT_WORKER_JOB_FAIL, {
      job: formatJobObject(job),
      worker: this.toJSON(),
      output: docOutput,
    });

    return this.client.update({
      index: job._index,
      type: job._type,
      id: job._id,
      version: job._version,
      body: { doc }
    })
      .then(() => true)
      .catch((err) => {
        if (err.statusCode === 409) return true;
        this.debug(`_failJob failed to update job ${job._id}`, err);
        this.emit(constants.EVENT_WORKER_FAIL_UPDATE_ERROR, this._formatErrorParams(err, job));
        return false;
      });
  }

  _formatOutput(output) {
    const unknownMime = false;
    const defaultOutput = null;
    const docOutput = {};

    if (typeof output === 'object' && output.content) {
      docOutput.content = output.content;
      docOutput.content_type = output.content_type || unknownMime;
      docOutput.max_size_reached = output.max_size_reached;
    } else {
      docOutput.content = output || defaultOutput;
      docOutput.content_type = unknownMime;
    }

    return docOutput;
  }

  _performJob(job) {
    this.debug(`Starting job ${job._id}`);

    const workerOutput = new Promise((resolve, reject) => {
      // run the worker's workerFn
      let isResolved = false;
      const cancellationToken = new CancellationToken();
      Promise.resolve(this.workerFn.call(null, job._source.payload, cancellationToken))
        .then((res) => {
          isResolved = true;
          resolve(res);
        })
        .catch((err) => {
          isResolved = true;
          reject(err);
        });

      // fail if workerFn doesn't finish before timeout
      setTimeout(() => {
        if (isResolved) return;

        cancellationToken.cancel();
        this.debug(`Timeout processing job ${job._id}`);
        reject(new WorkerTimeoutError(`Worker timed out, timeout = ${job._source.timeout}`, {
          timeout: job._source.timeout,
          jobId: job._id,
        }));
      }, job._source.timeout);
    });

    return workerOutput.then((output) => {
      // job execution was successful
      this.debug(`Completed job ${job._id}`);

      const completedTime = moment().toISOString();
      const docOutput = this._formatOutput(output);

      const doc = {
        status: constants.JOB_STATUS_COMPLETED,
        completed_at: completedTime,
        output: docOutput
      };

      return this.client.update({
        index: job._index,
        type: job._type,
        id: job._id,
        version: job._version,
        body: { doc }
      })
        .then(() => {
          const eventOutput = {
            job: formatJobObject(job),
            output: docOutput,
          };

          this.emit(constants.EVENT_WORKER_COMPLETE, eventOutput);
        })
        .catch((err) => {
          if (err.statusCode === 409) return false;
          this.debug(`Failure saving job output ${job._id}`, err);
          this.emit(constants.EVENT_WORKER_JOB_UPDATE_ERROR, this._formatErrorParams(err, job));
        });
    }, (jobErr) => {
      if (!jobErr) {
        jobErr = new UnspecifiedWorkerError('Unspecified worker error', {
          jobId: job._id,
        });
      }

      // job execution failed
      if (jobErr.name === 'WorkerTimeoutError') {
        this.debug(`Timeout on job ${job._id}`);
        this.emit(constants.EVENT_WORKER_JOB_TIMEOUT, this._formatErrorParams(jobErr, job));
        return;

      // append the jobId to the error
      } else {
        try {
          Object.assign(jobErr, { jobId: job._id });
        } catch (e) {
          // do nothing if jobId can not be appended
        }
      }

      this.debug(`Failure occurred on job ${job._id}`, jobErr);
      this.emit(constants.EVENT_WORKER_JOB_EXECUTION_ERROR, this._formatErrorParams(jobErr, job));
      return this._failJob(job, (jobErr.toString) ? jobErr.toString() : false);
    });
  }

  _startJobPolling() {
    if (!this._running) {
      return;
    }

    this._poller.start();
  }

  _stopJobPolling() {
    this._poller.stop();
  }

  _processPendingJobs() {
    return this._getPendingJobs()
      .then((jobs) => {
        return this._claimPendingJobs(jobs);
      });
  }

  _claimPendingJobs(jobs) {
    if (!jobs || jobs.length === 0) return;

    let claimed = false;

    // claim a single job, stopping after first successful claim
    return jobs.reduce((chain, job) => {
      return chain.then((claimedJob) => {
        // short-circuit the promise chain if a job has been claimed
        if (claimed) return claimedJob;

        return this._claimJob(job)
          .then((claimResult) => {
            if (claimResult !== false) {
              claimed = true;
              return claimResult;
            }
          });
      });
    }, Promise.resolve())
      .then((claimedJob) => {
        if (!claimedJob) {
          this.debug(`All ${jobs.length} jobs already claimed`);
          return;
        }
        this.debug(`Claimed job ${claimedJob._id}`);
        return this._performJob(claimedJob);
      })
      .catch((err) => {
        this.debug('Error claiming jobs', err);
      });
  }

  _getPendingJobs() {
    const nowTime = moment().toISOString();
    const query = {
      _source: {
        excludes: [ 'output.content' ]
      },
      query: {
        constant_score: {
          filter: {
            bool: {
              filter: { term: { jobtype: this.jobtype } },
              should: [
                { term: { status: 'pending' } },
                { bool: {
                  filter: [
                    { term: { status: 'processing' } },
                    { range: { process_expiration: { lte: nowTime } } }
                  ] }
                }
              ]
            }
          }
        }
      },
      sort: [
        { priority: { order: 'asc' } },
        { created_at: { order: 'asc' } }
      ],
      size: this.checkSize
    };

    this.debug('querying for outstanding jobs');

    return this.client.search({
      index: `${this.queue.index}-*`,
      type: this.doctype,
      version: true,
      body: query
    })
      .then((results) => {
        const jobs = results.hits.hits;
        this.debug(`${jobs.length} outstanding jobs returned`);
        return jobs;
      })
      .catch((err) => {
      // ignore missing indices errors
        if (err && err.status === 404) return [];

        this.debug('job querying failed', err);
        this.emit(constants.EVENT_WORKER_JOB_SEARCH_ERROR, this._formatErrorParams(err));
        throw err;
      });
  }
}
