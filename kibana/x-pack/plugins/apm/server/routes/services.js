import Joi from 'joi';
import Boom from 'boom';
import { getServices } from '../lib/services/get_services';
import { getService } from '../lib/services/get_service';
import { setupRequest } from '../lib/helpers/setup_request';
import { dateValidation } from '../lib/helpers/date_validation';

const ROOT = '/api/apm/services';
const pre = [{ method: setupRequest, assign: 'setup' }];
const defaultErrorHandler = reply => err => {
  console.error(err.stack);
  reply(Boom.wrap(err, 400));
};

export function initServicesApi(server) {
  server.route({
    method: 'GET',
    path: ROOT,
    config: {
      pre,
      validate: {
        query: Joi.object().keys({
          start: dateValidation,
          end: dateValidation
        })
      }
    },
    handler: (req, reply) => {
      const { setup } = req.pre;
      return getServices({ setup })
        .then(reply)
        .catch(defaultErrorHandler(reply));
    }
  });

  server.route({
    method: 'GET',
    path: `${ROOT}/{serviceName}`,
    config: {
      pre,
      validate: {
        query: Joi.object().keys({
          start: dateValidation,
          end: dateValidation
        })
      }
    },
    handler: (req, reply) => {
      const { setup } = req.pre;
      const { serviceName } = req.params;
      return getService({ serviceName, setup })
        .then(reply)
        .catch(defaultErrorHandler(reply));
    }
  });
}
