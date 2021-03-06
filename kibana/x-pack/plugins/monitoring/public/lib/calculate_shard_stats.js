import _ from 'lodash';

function addOne(obj, key) {
  let value = _.get(obj, key);
  _.set(obj, key, ++value);
}

export function calculateShardStats(state) {
  const data = { totals: { primary: 0, replica: 0, unassigned: { replica: 0, primary: 0 } } };
  const processShards = function (shard) {
    const metrics = data[shard.index] || { status: 'green', primary: 0, replica: 0, unassigned: { replica: 0, primary: 0 } };
    let key = '';
    if (shard.state !== 'STARTED') {
      key = 'unassigned.';
      if (metrics.status !== 'red') {
        metrics.status = (shard.primary && shard.state === 'UNASSIGNED') ? 'red' : 'yellow';
      }
    }
    key += shard.primary ? 'primary' : 'replica';
    addOne(metrics, key);
    addOne(data.totals, key);
    data[shard.index] = metrics;
  };
  if (state) {
    const shards = _.get(state, 'cluster_state.shards');
    _.each(shards, processShards);
  }
  return data;
}
