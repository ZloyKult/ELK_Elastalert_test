/*
 * Calculate totals from mapped indices data
 */
export function calculateIndicesTotals(indices) {
  // create datasets for each index
  const metrics = Object.keys(indices).map(i => {
    const index = indices[i];
    return {
      primary: index.primary,
      replica: index.replica,
      unassignedPrimary: index.unassigned.primary,
      unassignedReplica: index.unassigned.replica,
    };
  });

  // sum up the metrics of each data set
  return {
    primary: metrics.reduce((sum, value) => (sum + value.primary), 0),
    replica: metrics.reduce((sum, value) => (sum + value.replica), 0),
    unassigned: {
      primary: metrics.reduce((sum, value) => (sum + value.unassignedPrimary), 0),
      replica: metrics.reduce((sum, value) => (sum + value.unassignedReplica), 0),
    }
  };
}
