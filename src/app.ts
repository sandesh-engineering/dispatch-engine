import { createTracing } from '@platform/tracing';

const sdk = createTracing({
  serviceName: process.env.SERVICE_NAME ?? 'dispatch-engine',
  serviceVersion: '1.0.0',
  collectorUrl:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  samplingRatio: process.env.NODE_ENV === 'development' ? 1 : 0.3,
});

sdk.start();

import { httpLoggerMiddleware } from '@platform/logger';

import client from 'prom-client';

const collectDefaultMetrics = client.collectDefaultMetrics;

collectDefaultMetrics({
  prefix: 'node_app_dispatch_engine_',
});

import path from 'path';

import dotenv from 'dotenv';
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import express, { Express } from 'express';

import { errorMiddleware } from './middlewares/error.middleware';
import { cacheService } from './utils/cache-bootstrap';

const app: Express = express();

/* For CORS */
const corsOptions = {
  origin: process.env.FRONTEND_URL,
  methods: ['GET , POST , PUT ,DELETE , PATCH , HEAD'],
  credentials: true,
};

/* Middlewares */
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));
app.use(httpLoggerMiddleware);

// app.use('/api-docs/v1', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.post('/api/v1/nearby-delivery-agents', async (request, response) => {
  const body = request.body as { longitude: number; latitude: number };

  const nearbyAgents = await cacheService.geoSearch(
    'location:delivery-agents',
    { longitude: body.longitude, latitude: body.latitude },
    5,
    'km',
    { withDist: true, withCoord: true, count: 10, sort: 'ASC' },
  );

  return response.status(200).json({ nearbyAgents });
});

/* Metrics */
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

/* Error middleware */
app.use(errorMiddleware);

export { app };
