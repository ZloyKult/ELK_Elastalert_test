import { oncePerServer } from './once_per_server';

function getDocumentPayloadFn(server) {
  const exportTypesRegistry = server.plugins.reporting.exportTypesRegistry;

  function encodeContent(content, jobType) {
    if (!jobType) {
      return content;
    }

    const exportType = exportTypesRegistry.get(item => item.jobType === jobType);
    switch (exportType.jobContentEncoding) {
      case 'base64':
        return new Buffer(content, 'base64');
      default:
        return content;
    }
  }

  function getCompleted(output, jobType) {
    return {
      statusCode: 200,
      content: encodeContent(output.content, jobType),
      contentType: output.content_type
    };
  }

  function getFailure(output) {
    return {
      statusCode: 500,
      content: {
        message: 'Reporting generation failed',
        reason: output.content
      },
      contentType: 'application/json'
    };
  }

  function getIncomplete(status) {
    return {
      statusCode: 503,
      content: status,
      contentType: 'application/json',
      headers: {
        'retry-after': 30
      }
    };
  }

  return function getDocumentPayload(doc) {
    const { status, output, jobtype: jobType } = doc._source;

    if (status === 'completed') {
      return getCompleted(output, jobType);
    }

    if (status === 'failed') {
      return getFailure(output);
    }

    // send a 503 indicating that the report isn't completed yet
    return getIncomplete(status);
  };
}

export const getDocumentPayloadFactory = oncePerServer(getDocumentPayloadFn);

